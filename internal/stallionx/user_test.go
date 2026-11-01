package stallionx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestUserHasOneVerifiedStateAndAutomaticSetup(t *testing.T) {
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = SignOut() })
	fake := &fakeService{codes: map[string]string{}}
	baseHandler := fake.handler(t)
	var lock sync.Mutex
	refuseSelf, failModels, failProvision := false, false, false
	var selfReads int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lock.Lock()
		reject, models, provision := refuseSelf, failModels, failProvision
		if r.URL.Path == "/api/user/self" {
			selfReads++
		}
		lock.Unlock()
		fail := func() { w.WriteHeader(503); json.NewEncoder(w).Encode(envelope{Message: "fixture unavailable"}) }
		switch r.URL.Path {
		case "/api/user/self":
			if reject {
				fail()
				return
			}
			email := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer jwt-for-")
			json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"id": "user_safe", "email": email, "username": "alice_x1", "balance": "12.500001", "used_amount": "1.20", "status": 1, "active_tokens": 1, "billing_mode": 1, "email_verified": true, "created_at": "2026-11-01T00:00:00Z", "group_name": "Standard", "role": 999, "refresh": "secret-refresh", "password": "secret-password", "key": "secret-key"}})
			return
		case "/v1/models", "/models":
			if models {
				fail()
				return
			}
		case "/api/cli/provision":
			if provision {
				fail()
				return
			}
		}
		baseHandler.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL)
	ctx := context.Background()
	if st := User(ctx); st.State != "signed_out" || st.Profile != nil {
		t.Fatalf("new user: %+v", st)
	}
	SendCode(ctx, "alice@example.com", "en")
	lock.Lock()
	failProvision = true
	lock.Unlock()
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	st := User(ctx)
	if st.State != "authenticated" || st.Setup != "failed" || st.ProviderConnected || st.SetupMessage == "" {
		t.Fatalf("setup failure became logout: %+v", st)
	}
	lock.Lock()
	failProvision = false
	failModels = true
	lock.Unlock()
	st = SyncAccount(ctx)
	if st.State != "authenticated" || st.Setup != "failed" || !st.ProviderConnected {
		t.Fatalf("model-list failure: %+v", st)
	}
	lock.Lock()
	failModels = false
	lock.Unlock()
	st = SyncAccount(ctx)
	if st.State != "authenticated" || st.Setup != "ready" || !st.ProviderConnected || st.Profile == nil || st.Profile.Balance != "12.500001" {
		t.Fatalf("ready: %+v", st)
	}
	if !slices.ContainsFunc(provider.Served(), func(e provider.Entry) bool { return e.ID == ProviderID+"/fixture-model" }) {
		t.Fatal("automatic login setup did not expose models to agents")
	}
	b, _ := json.Marshal(st)
	for _, secret := range []string{"secret-", "password", "refresh", "\"role\""} {
		if strings.Contains(string(b), secret) {
			t.Fatal("profile leaks internal field", secret)
		}
	}
	forgetWallet()
	// Session restoration must load the real numeric billing enum too, rather
	// than succeeding only because the fake server omitted that field.
	if st := User(ctx); st.State != "authenticated" || st.Setup != "ready" || st.Profile == nil || st.Profile.BillingMode != 1 {
		t.Fatalf("restart: %+v", st)
	}
	invalidateAccess()
	cached := Access(ctx)
	cached.Profile.Balance = "changed by caller"
	lock.Lock()
	before := selfReads
	lock.Unlock()
	for i := 0; i < 3; i++ {
		if st := Access(ctx); st.State != "authenticated" || st.Profile.Balance != "12.500001" {
			t.Fatal(st)
		}
	}
	lock.Lock()
	if selfReads != before {
		t.Error("access cache did not reuse verified state")
	}
	lock.Unlock()
	if err := provider.Delete(ProviderID); err != nil {
		t.Fatal(err)
	}
	if st := Access(ctx); st.State != "authenticated" || st.Setup != "failed" || st.ProviderConnected {
		t.Fatalf("removed provider is not a logout: %+v", st)
	}
	lock.Lock()
	refuseSelf = true
	lock.Unlock()
	if st := User(ctx); st.State != "unavailable" || st.Profile != nil || st.Email != "alice@example.com" {
		t.Fatalf("outage: %+v", st)
	}
	lock.Lock()
	refuseSelf = false
	lock.Unlock()
	if err := os.WriteFile(walletFile(), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if st := User(ctx); st.State != "unavailable" {
		t.Fatalf("corrupt session treated as logout: %+v", st)
	}
	if err := os.Remove(walletFile()); err != nil {
		t.Fatal(err)
	}
	if st := User(ctx); st.State != "expired" || st.Email != "alice@example.com" {
		t.Fatalf("legacy account: %+v", st)
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	if st := Access(ctx); st.State != "signed_out" || st.Profile != nil {
		t.Fatalf("logout: %+v", st)
	}
}

func TestAccountSetupDoesNotReplaceCustomProviderCredentials(t *testing.T) {
	fake := &fakeService{}
	serve(t, fake)
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err := provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	p.Key = "user-managed-key"
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	if st := SyncAccount(ctx); st.State != "authenticated" || st.Setup != "failed" || st.ProviderConnected {
		t.Fatalf("custom credentials did not block automatic setup: %+v", st)
	}
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err = provider.Find(ProviderID)
	if err != nil || p.Key != "user-managed-key" {
		t.Fatal("signing in again overwrote manually edited credentials", p, err)
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	p, err = provider.Find(ProviderID)
	if err != nil || p.Key != "user-managed-key" {
		t.Fatal("sign-out removed manually edited credentials", p, err)
	}
	if err := provider.Delete(ProviderID); err != nil {
		t.Fatal(err)
	}
}

func TestUserProfileRejectsNonDecimalBalance(t *testing.T) {
	for _, value := range []string{"NaN", "Inf", "-Infinity", "1e4", "1.2.3"} {
		raw, _ := json.Marshal(map[string]any{"username": "alice", "email": "alice@example.com", "balance": value})
		if _, err := decodeProfile(raw); err == nil {
			t.Errorf("accepted invalid balance %q", value)
		}
	}
}

func TestUserReadCompletingAfterSignOutCannotReopenWorkspace(t *testing.T) {
	fake := &fakeService{}
	serve(t, fake)
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	oldClient := client
	reached, release := make(chan struct{}), make(chan struct{})
	client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/user/self" {
			close(reached)
			<-release
		}
		return oldClient.Transport.RoundTrip(r)
	})}
	t.Cleanup(func() { client = oldClient })
	result := make(chan UserStatus, 1)
	go func() { result <- User(ctx) }()
	<-reached
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	close(release)
	st := <-result
	if st.State == "authenticated" {
		t.Fatal("stale response reopened signed-out workspace")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
