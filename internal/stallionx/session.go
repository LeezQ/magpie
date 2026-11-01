package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/steady"
)

// This private file is not account metadata or part of the backup allowlist.
// Credentials never reach the webview; refresh is sent only to /api/user/refresh.
type accountSession struct {
	Token   string `json:"token"`
	Refresh string `json:"refresh"`
	Service string `json:"service"`
	Email   string `json:"email"`
	KeyHash string `json:"keyHash"`
}

func walletFile() string { return filepath.Join(appdir.Config(), "stallionx-session.json") }

func saveWallet(token, refresh string, s saved) error {
	b, err := json.Marshal(accountSession{token, refresh, s.Service, s.Email, s.KeyHash})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(appdir.Config(), 0700); err != nil {
		return err
	}
	// CreateTemp starts at 0600: there must be no world-readable interval.
	f, err := os.CreateTemp(appdir.Config(), ".stallionx-session-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := steady.Rename(f.Name(), walletFile()); err != nil {
		return err
	}
	rememberWallet(token, s)
	invalidateAccess()
	return nil
}

func readSession(st Status, hash string) (accountSession, error) {
	b, err := os.ReadFile(walletFile())
	if os.IsNotExist(err) {
		return accountSession{}, ErrWalletSession
	}
	if err != nil {
		return accountSession{}, err
	}
	var s accountSession
	if err := json.Unmarshal(b, &s); err != nil {
		return s, err
	}
	if s.Service != st.Service || s.Email != st.Email || s.KeyHash != hash {
		return accountSession{}, ErrWalletSession
	}
	return s, nil
}

var renewal sync.Mutex

// Concurrent balance/config reads share one refresh. No financial operation is
// repeated unless its first response was an explicit authentication rejection.
func renewWallet(ctx context.Context, st Status, hash, rejected string) (string, error) {
	renewal.Lock()
	defer renewal.Unlock()
	mu.Lock()
	original, accountErr := readAccount()
	s, err := readSession(st, hash)
	mu.Unlock()
	if accountErr != nil || original.Service != st.Service || original.Email != st.Email || original.KeyHash != hash {
		return "", ErrWalletSession
	}
	if err != nil {
		return "", err
	}
	if s.Token != "" && s.Token != rejected {
		return s.Token, nil
	}
	if s.Refresh == "" {
		return "", ErrWalletSession
	}
	var result struct {
		Token string `json:"token"`
	}
	originalRefresh := s.Refresh
	err = sessionRequest(ctx, http.MethodPost, s.Service, "/api/user/refresh", "", map[string]any{}, &result, &s.Refresh)
	if err != nil {
		var refused *serviceError
		if errors.As(err, &refused) && refused.status == 401 {
			return "", ErrWalletSession
		}
		return "", err
	}
	if result.Token == "" {
		return "", errors.New("StallionX returned no renewed session")
	}
	mu.Lock()
	defer mu.Unlock()
	// Sign-out, a different login or a changed key during refresh wins.
	account, accountErr := readAccount()
	now := statusOf(account, true)
	latest, err := readSession(now, hash)
	// Access JWTs can be identical across logins issued in the same second;
	// compare the login generation and refresh credential, not only the JWT.
	if accountErr != nil || err != nil || account.At != original.At || account.KeyHash != hash || latest.Token != s.Token || latest.Refresh != originalRefresh || now.Service != st.Service || now.Email != st.Email {
		return "", ErrWalletSession
	}
	if err := saveWallet(result.Token, s.Refresh, saved{Email: s.Email, Service: s.Service, KeyHash: s.KeyHash}); err != nil {
		return "", err
	}
	return result.Token, nil
}
