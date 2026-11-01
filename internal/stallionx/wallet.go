package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/yetone/magpie/internal/provider"
)

// A missing or rejected account session is distinct from a service outage.
var ErrWalletSession = errors.New("sign in to your StallionX account to continue")

var walletSession struct {
	sync.Mutex
	token, service, email, keyHash string
}

func rememberWallet(token string, s saved) {
	walletSession.Lock()
	defer walletSession.Unlock()
	walletSession.token, walletSession.service = token, s.Service
	walletSession.email, walletSession.keyHash = s.Email, s.KeyHash
}

func forgetWallet() {
	walletSession.Lock()
	defer walletSession.Unlock()
	walletSession.token = ""
}

// VerifyWallet restores account access without replacing the provider or key.
func VerifyWallet(ctx context.Context, code, locale string) error {
	st := Current()
	if !st.SignedIn {
		return ErrWalletSession
	}
	p, err := provider.Find(ProviderID)
	if err != nil {
		return err
	}
	hash := keyHash(p.Key)
	var login loginData
	var refresh string
	if err := sessionRequest(ctx, http.MethodPost, st.Service, "/api/user/email-login", "", map[string]any{
		"email": st.Email, "verification_code": strings.TrimSpace(code), "locale": locale, "agree_terms": true, "remember_me": true,
	}, &login, &refresh); err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	now := Current()
	p, err = provider.Find(ProviderID)
	if err != nil || !now.SignedIn || now.Email != st.Email || now.Service != st.Service || keyHash(p.Key) != hash {
		return ErrWalletSession
	}
	if login.Token == "" || !strings.EqualFold(login.User.Email, st.Email) {
		return errors.New("StallionX returned a different account or no session")
	}
	return saveWallet(login.Token, refresh, saved{Email: st.Email, Service: st.Service, KeyHash: hash})
}

// Wallet only exposes fixed personal-account operations. Callers cannot supply
// an upstream path, user ID, credential or redirect target.
func Wallet(ctx context.Context, action string, query url.Values, value string) (json.RawMessage, error) {
	method, path := http.MethodGet, ""
	var body any
	q := url.Values{}
	switch action {
	case "balance":
		path = "/api/user/self"
	case "config":
		path = "/api/payment/config"
	case "orders":
		path = "/api/payment/orders"
		for _, k := range []string{"page", "page_size"} {
			if v := query.Get(k); v != "" {
				q.Set(k, v)
			}
		}
	case "keys":
		// The personal endpoint returns plaintext keys. Redact its response below
		// before it can cross the webview boundary; never call admin key routes.
		path = "/api/token/"
		q.Set("workspace", "personal")
		for _, k := range []string{"page", "page_size"} {
			if v := query.Get(k); v != "" {
				q.Set(k, v)
			}
		}
	case "logs":
		path = "/api/log/self"
		for _, k := range []string{"page", "page_size", "model", "status", "start_timestamp", "end_timestamp"} {
			if v := query.Get(k); v != "" {
				q.Set(k, v)
			}
		}
	case "create":
		method, path = http.MethodPost, "/api/payment/orders"
		body = map[string]string{"amount": strings.TrimSpace(value)}
	case "redeem":
		method, path = http.MethodPost, "/api/user/topup"
		body = map[string]string{"code": strings.TrimSpace(value)}
	default:
		return nil, errors.New("unknown wallet operation")
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	out, err := accountRequest(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 || string(out) == "null" {
		return nil, errors.New("StallionX returned no wallet data")
	}
	if action == "keys" || action == "logs" {
		return publicAccountRecords(action, out)
	}
	if action == "balance" {
		var user struct {
			Balance json.RawMessage `json:"balance"`
		}
		if err := json.Unmarshal(out, &user); err != nil {
			return nil, err
		}
		if len(user.Balance) == 0 || string(user.Balance) == "null" {
			return nil, errors.New("StallionX returned no balance")
		}
		return json.Marshal(user)
	}
	return out, nil
}

// accountRequest is shared by every user-owned capability, including setup.
func accountRequest(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	mu.Lock()
	s, err := readAccount()
	var session accountSession
	if err == nil {
		session, err = readSession(statusOf(s, true), s.KeyHash)
	}
	mu.Unlock()
	if os.IsNotExist(err) {
		return nil, ErrWalletSession
	}
	if err != nil {
		return nil, err
	}
	if s.Service != Base() {
		return nil, ErrWalletSession
	}
	st := statusOf(s, true)
	token := session.Token
	if token == "" {
		token, err = renewWallet(ctx, st, s.KeyHash, "")
		if err != nil {
			return nil, err
		}
	}
	var out json.RawMessage
	if err := request(ctx, method, s.Service, path, token, body, &out); err != nil {
		var refused *serviceError
		if !errors.As(err, &refused) || refused.status != http.StatusUnauthorized {
			return nil, err
		}
		token, err = renewWallet(ctx, st, s.KeyHash, token)
		if err != nil {
			return nil, err
		}
		if err = request(ctx, method, s.Service, path, token, body, &out); err != nil {
			if errors.As(err, &refused) && refused.status == http.StatusUnauthorized {
				return nil, ErrWalletSession
			}
			return nil, err
		}
	}
	now, err := readAccount()
	if err != nil || now.At != s.At || now.Email != s.Email || now.Service != s.Service {
		return nil, ErrWalletSession
	}
	return out, nil
}
