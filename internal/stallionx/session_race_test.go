package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestDelayedRefreshCannotReplaceNewLoginWithSameAccessToken(t *testing.T) {
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = SignOut() })
	fake := &fakeService{codes: map[string]string{"alice@example.com": "123456"}}
	auth := fake.handler(t)
	reached, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	var firstLogin sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/user/email-login":
			refresh := "new-login-refresh"
			firstLogin.Do(func() { refresh = "first-login-refresh" })
			http.SetCookie(w, &http.Cookie{Name: "stallion_refresh_token", Value: refresh, Path: "/api/user", HttpOnly: true})
		case "/api/user/refresh":
			close(reached)
			<-release
			http.SetCookie(w, &http.Cookie{Name: "stallion_refresh_token", Value: "old-login-rotated", Path: "/api/user", HttpOnly: true})
			json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]string{"token": "old-login-renewed"}})
			return
		}
		auth.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	t.Setenv("STALLIONX_URL", server.URL)
	ctx := context.Background()
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	hash := walletHash(t)
	st := Current()
	original, err := readSession(st, hash)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	var refreshErr error
	go func() {
		defer close(finished)
		_, refreshErr = renewWallet(ctx, st, hash, original.Token)
	}()
	t.Cleanup(func() { unblock(); <-finished })
	<-reached
	// Stallion's JWT has no random jti and timestamps have second precision,
	// so a replacement login may carry exactly the same access token.
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	replacement, err := readSession(Current(), walletHash(t))
	if err != nil || replacement.Token != original.Token || replacement.Refresh != "new-login-refresh" {
		t.Fatalf("replacement fixture: %+v %v", replacement, err)
	}
	unblock()
	<-finished
	if !errors.Is(refreshErr, ErrWalletSession) {
		t.Fatalf("old refresh was not discarded: %v", refreshErr)
	}
	got, err := readSession(Current(), walletHash(t))
	if err != nil || got != replacement {
		t.Fatalf("old refresh overwrote new login: %+v, want %+v (%v)", got, replacement, err)
	}
	if st := User(ctx); st.State != "authenticated" || st.Setup != "ready" {
		t.Fatalf("replacement login lost: %+v", st)
	}
}
