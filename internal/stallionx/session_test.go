package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func TestWalletRestartsAndRenewsOnce(t *testing.T) {
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = SignOut() })
	fake := &fakeService{codes: map[string]string{}}
	auth := fake.handler(t)
	var lock sync.Mutex
	refreshes, redeemed := 0, 0
	expired, unavailable, revoked := false, false, false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/user/email-login" {
			http.SetCookie(w, &http.Cookie{Name: "stallion_refresh_token", Value: "refresh-one", HttpOnly: true, Path: "/api/user"})
			auth.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api/user/verification" || r.URL.Path == "/api/cli/provision" {
			auth.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/models" || r.URL.Path == "/v1/models" {
			w.WriteHeader(404)
			return
		}
		lock.Lock()
		defer lock.Unlock()
		reply := func(code int, data any) {
			w.WriteHeader(code)
			json.NewEncoder(w).Encode(map[string]any{"success": code == 200, "data": data, "message": "fixture error"})
		}
		if r.URL.Path == "/api/user/logout" {
			reply(200, nil)
			return
		}
		if r.URL.Path == "/api/user/refresh" {
			refreshes++
			c, err := r.Cookie("stallion_refresh_token")
			if err != nil || (c.Value != "refresh-one" && c.Value != "refresh-two") {
				t.Error("refresh cookie missing")
			}
			if revoked {
				reply(401, nil)
				return
			}
			if unavailable {
				reply(503, nil)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "stallion_refresh_token", Value: "refresh-two", Path: "/api/user", HttpOnly: true})
			reply(200, map[string]string{"token": "renewed"})
			return
		}
		if _, err := r.Cookie("stallion_refresh_token"); err == nil {
			t.Error("refresh cookie leaked to a business endpoint")
		}
		if expired && r.Header.Get("Authorization") != "Bearer renewed" {
			reply(401, nil)
			return
		}
		if r.URL.Path == "/api/user/topup" {
			redeemed++
		}
		reply(200, map[string]string{"balance": "12.30"})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL)
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(walletFile())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("session permissions: %v", info.Mode())
	}
	forgetWallet() // restart: all in-memory session state is gone
	if _, err := Wallet(ctx, "balance", nil, ""); err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	expired = true
	lock.Unlock()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := Wallet(ctx, "balance", nil, ""); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	lock.Lock()
	if refreshes != 1 {
		t.Errorf("concurrent reads refreshed %d times", refreshes)
	}
	lock.Unlock()
	forgetWallet()
	s, err := readSession(Current(), walletHash(t))
	if err != nil {
		t.Fatal(err)
	}
	if s.Refresh != "refresh-two" || s.Token != "renewed" {
		t.Fatal("rotation not persisted")
	}
	if _, err := Wallet(ctx, "redeem", nil, "TEST"); err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	if redeemed != 1 {
		t.Fatal("redemption repeated")
	}
	unavailable = true
	lock.Unlock()
	// Reject the saved access token and force a refresh failure.
	if err := saveWallet("old", "refresh-two", saved{Email: s.Email, Service: s.Service, KeyHash: s.KeyHash}); err != nil {
		t.Fatal(err)
	}
	if _, err := Wallet(ctx, "balance", nil, ""); err == nil || errors.Is(err, ErrWalletSession) {
		t.Fatalf("outage misreported as logout: %v", err)
	}
	lock.Lock()
	unavailable = false
	revoked = true
	lock.Unlock()
	if _, err := Wallet(ctx, "balance", nil, ""); !errors.Is(err, ErrWalletSession) {
		t.Fatalf("revocation: %v", err)
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(walletFile()); !os.IsNotExist(err) {
		t.Fatal("sign-out kept credentials")
	}
}

func walletHash(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(accountFile())
	if err != nil {
		t.Fatal(err)
	}
	var s saved
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	return s.KeyHash
}
