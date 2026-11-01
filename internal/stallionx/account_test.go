package stallionx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/testenv"
)

// The tests run in a home of their own, never the user's real files, and
// ask a fake service on loopback, never the real one.
func TestMain(m *testing.M) { testenv.Main(m) }

// fakeService answers the three calls a sign-in makes the way Stallion-X
// does (the { success, message, data } envelope), and records what it was
// sent.
type fakeService struct {
	mu        sync.Mutex
	codes     map[string]string // email → the code it mailed
	logins    []map[string]any
	provision []string // the Authorization header of each provision
	tokenName string
	testMode  bool // hands the code back, as the service does with no mail set up
}

func (f *fakeService) handler(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	reply := func(rw http.ResponseWriter, status int, ok bool, msg string, data any) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(status)
		json.NewEncoder(rw).Encode(map[string]any{"success": ok, "message": msg, "data": data})
	}
	mux.HandleFunc("POST /api/user/verification", func(rw http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		f.codes[in["email"]] = "123456"
		f.mu.Unlock()
		if f.testMode {
			reply(rw, 200, true, "ok", map[string]string{"message": "sent", "code": "123456"})
			return
		}
		reply(rw, 200, true, "ok", map[string]string{"message": "sent"})
	})
	mux.HandleFunc("POST /api/user/email-login", func(rw http.ResponseWriter, r *http.Request) {
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		f.logins = append(f.logins, in)
		want := f.codes[in["email"].(string)]
		f.mu.Unlock()
		if want == "" || in["verification_code"] != want {
			reply(rw, 400, false, "验证码错误", nil)
			return
		}
		reply(rw, 200, true, "ok", map[string]any{
			"token":  "jwt-for-" + in["email"].(string),
			"user":   map[string]any{"username": "alice_x1", "email": in["email"]},
			"is_new": true,
		})
	})
	mux.HandleFunc("POST /api/cli/provision", func(rw http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(r.Body).Decode(&in)
		f.mu.Lock()
		f.provision = append(f.provision, r.Header.Get("Authorization"))
		f.tokenName = in["name"]
		f.mu.Unlock()
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer jwt-for-") {
			reply(rw, 401, false, "未登录", nil)
			return
		}
		reply(rw, 200, true, "ok", map[string]any{"key": "sk-stallionx-test", "username": "alice_x1", "balance": "12.5"})
	})

	mux.HandleFunc("GET /api/user/self", func(w http.ResponseWriter, r *http.Request) {
		email := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer jwt-for-")
		reply(w, 200, true, "", map[string]any{"id": "user_fixture", "username": "alice_x1", "email": email, "balance": "12.5", "email_verified": true, "status": 1, "used_amount": "2.1", "active_tokens": 1})
	})
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "fixture-model", "object": "model"}}})
	})
	mux.HandleFunc("POST /api/user/logout", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, true, "", nil) })
	return mux
}

// serve starts f and points the package at it.
func serve(t *testing.T, f *fakeService) string {
	t.Helper()
	// each test starts and ends signed out: the package's home is shared
	reset := func() {
		if _, err := SignOut(); err != nil {
			t.Fatal(err)
		}
	}
	reset()
	t.Cleanup(reset)
	f.codes = map[string]string{}
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL+"/")
	return srv.URL
}

// TestSignInSavesTheProvider holds the whole sign-in: the code is asked
// for, the login answers a token, the token is traded for the key, and
// the key is saved as the StallionX provider at the service's endpoints.
// The access token is never written to disk.
func TestSignInSavesTheProvider(t *testing.T) {
	f := &fakeService{}
	base := serve(t, f)
	ctx := context.Background()

	if Current().SignedIn {
		t.Fatal("signed in before signing in")
	}
	sent, err := SendCode(ctx, " alice@example.com ", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if sent.TestCode != "" {
		t.Errorf("TestCode %q from a service that mails the code", sent.TestCode)
	}
	st, err := SignIn(ctx, "alice@example.com", " 123456 ", "", "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if !st.SignedIn || st.Email != "alice@example.com" || st.Username != "alice_x1" || !st.IsNew || st.Balance != "12.5" || st.Service != base {
		t.Errorf("status after sign-in: %+v", st)
	}
	if len(f.logins) != 1 || f.logins[0]["agree_terms"] != true || f.logins[0]["locale"] != "zh-CN" {
		t.Errorf("login request: %+v", f.logins)
	}
	if _, has := f.logins[0]["invite_code"]; has {
		t.Errorf("an empty invite code was sent: %+v", f.logins[0])
	}
	if len(f.provision) != 1 || f.provision[0] != "Bearer jwt-for-alice@example.com" || f.tokenName != tokenName {
		t.Errorf("provision: auth %v, name %q", f.provision, f.tokenName)
	}

	p, err := provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != ProviderID || p.Key != "sk-stallionx-test" || p.Chat != base+"/v1" || p.Responses != base+"/v1" || p.Anthropic != base ||
		p.BalanceURL != base+"/api/usage/token" || p.Preset != ProviderID {
		t.Errorf("saved provider: %+v", p)
	}
	b, err := os.ReadFile(accountFile())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "jwt-for") || strings.Contains(string(b), "sk-") {
		t.Errorf("account.json holds a secret: %s", b)
	}
	if again := Current(); !again.SignedIn || again.Email != "alice@example.com" {
		t.Errorf("Current after sign-in: %+v", again)
	}
}

// TestSignInWrongCode: the service's refusal reaches the page as it wrote
// it, and nothing is saved.
func TestSignInWrongCode(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	if _, err := SendCode(ctx, "bob@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	_, err := SignIn(ctx, "bob@example.com", "999999", "", "en")
	if err == nil || err.Error() != "验证码错误" {
		t.Fatalf("err = %v, want the service's message", err)
	}
	if len(f.provision) != 0 {
		t.Errorf("provisioned after a refused login")
	}
	if Current().SignedIn {
		t.Error("signed in after a refused login")
	}
	if p, err := provider.Find(ProviderID); err == nil && p.ID == ProviderID {
		t.Errorf("provider saved after a refused login: %+v", p)
	}
}

// TestSendCodeTestMode: a service with no mail hands the code back, and
// the page gets it to fill in.
func TestSendCodeTestMode(t *testing.T) {
	f := &fakeService{testMode: true}
	serve(t, f)
	sent, err := SendCode(context.Background(), "carol@example.com", "en")
	if err != nil {
		t.Fatal(err)
	}
	if sent.TestCode != "123456" {
		t.Errorf("TestCode = %q", sent.TestCode)
	}
}

// TestBadInputAsksNothing: an address that isn't one, or no code, is
// refused before the service is asked.
func TestBadInputAsksNothing(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	if _, err := SendCode(ctx, "not-an-email", "en"); err == nil {
		t.Error("SendCode took an address with no @")
	}
	if _, err := SignIn(ctx, "dave@example.com", "  ", "", "en"); err == nil {
		t.Error("SignIn took an empty code")
	}
	if len(f.codes) != 0 || len(f.logins) != 0 {
		t.Errorf("the service was asked: codes %v, logins %v", f.codes, f.logins)
	}
}

// TestSignOutRemovesTheProvider: signing out takes the key off this
// computer, and a provider removed on the Providers page counts as signed
// out too.
func TestSignOutRemovesTheProvider(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	if _, err := SendCode(ctx, "erin@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "erin@example.com", "123456", "INV1", "en"); err != nil {
		t.Fatal(err)
	}
	if f.logins[0]["invite_code"] != "INV1" {
		t.Errorf("invite code not sent: %+v", f.logins[0])
	}
	st, err := SignOut()
	if err != nil {
		t.Fatal(err)
	}
	if st.SignedIn {
		t.Error("signed in after signing out")
	}
	if p, err := provider.Find(ProviderID); err == nil && p.ID == ProviderID {
		t.Errorf("provider kept after sign-out: %+v", p)
	}
	if _, err := os.Stat(accountFile()); !os.IsNotExist(err) {
		t.Errorf("account.json kept after sign-out: %v", err)
	}

	// signed in again, then the provider is deleted by hand
	if _, err := SendCode(ctx, "erin@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "erin@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	if err := provider.Delete(ProviderID); err != nil {
		t.Fatal(err)
	}
	if Current().SignedIn {
		t.Error("signed in with its provider deleted")
	}
}

// TestSignInKeepsUserSettings: signing in again replaces the key and the
// endpoints, and keeps a name the user gave the provider.
func TestSignInKeepsUserSettings(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	if _, err := SendCode(ctx, "fay@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "fay@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err := provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	p.Name = "My StallionX"
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	if _, err := SendCode(ctx, "fay@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "fay@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err = provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "My StallionX" || p.Key != "sk-stallionx-test" {
		t.Errorf("after signing in again: name %q key %q", p.Name, p.Key)
	}
}

// Authentication redirects may carry the code in a preserved POST body. No
// server redirect is trusted to choose a new destination for that credential.
func TestAuthenticationDoesNotFollowRedirect(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true; w.WriteHeader(200) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	if err := call(context.Background(), source.URL, "/api/user/email-login", "", map[string]string{"verification_code": "123456"}, nil); err == nil {
		t.Fatal("redirect accepted")
	}
	if reached {
		t.Fatal("authentication redirect followed")
	}
}

// A user-added credential is not owned by the sign-in, even when it shares
// the provider ID. Signing out must not erase it or additional accounts.
func TestSignOutPreservesEditedCredentials(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	if _, err := SendCode(ctx, "edited@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "edited@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err := provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	original := p.Key
	p.Key = "user-edited-key"
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	if Current().SignedIn {
		t.Fatal("edited key still shown as authenticated account")
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	p, err = provider.Find(ProviderID)
	if err != nil || p.Key != "user-edited-key" {
		t.Fatal("edited credential lost")
	}
	_ = original
	if err := provider.Delete(ProviderID); err != nil {
		t.Fatal(err)
	}
}
