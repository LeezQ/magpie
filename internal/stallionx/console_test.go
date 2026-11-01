package stallionx

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const fixtureKeyID = "key_0123456789abcdef0123456789abcdef"

func consoleFixture(t *testing.T, handler http.HandlerFunc) string {
	t.Helper()
	f := &fakeService{codes: map[string]string{}}
	auth := f.handler(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/user/logout" {
			auth.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer fixture-jwt" {
			t.Error("console did not use the pinned server-only JWT")
		}
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL)
	s := saved{Service: srv.URL, Email: "alice@example.com", At: time.Now(), KeyHash: keyHash("sk-managed")}
	mu.Lock()
	err := writeAccount(s)
	if err == nil {
		err = saveWallet("fixture-jwt", "", s)
	}
	mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = SignOut() })
	return consoleBinding(s)
}

func consoleReply(w http.ResponseWriter, value any) {
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": value})
}

func consoleCall(binding, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	ConsoleServe(w, httptest.NewRequest(method, path, strings.NewReader(body)), binding)
	return w
}

func TestConsoleCustomerAllowlist(t *testing.T) {
	for _, path := range []string{"/api/token/all", "/api/token/123", "/api/token/" + fixtureKeyID + "/key", "/api/channel/", "/api/user/other", "/api/payment/admin/orders", "/api/team/", "/api/option/", "/api/log/", "/api/log/self/perf/realtime", "/api/team/team_fixture/status", "/api/oauth/google/authorize"} {
		if _, ok := consolePolicy("GET", path); ok {
			t.Errorf("platform/unsupported route allowed: %s", path)
		}
	}
	var calls atomic.Int32
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); consoleReply(w, map[string]any{}) })
	for _, test := range []struct{ method, path, body string }{
		{"POST", "/api/payment/orders", `{"amount":"1.25","user_id":"other"}`},
		{"GET", "/api/payment/orders?user_id=other", ""},
		{"GET", "/api/token/?page=1&page=2", ""},
		{"PUT", "/api/token/", `{"status":2}`},
		{"PUT", "/api/user/self", `{"role":999}`},
	} {
		w := consoleCall(binding, test.method, test.path, test.body)
		if w.Code != 403 {
			t.Fatalf("invalid input accepted: %s %d %s", test.path, w.Code, w.Body.String())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("refused input reached the service")
	}
}

func TestConsolePersonalScopeRedactionAndExactMoney(t *testing.T) {
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("workspace") != "personal" {
			t.Errorf("unscoped personal list: %s", r.URL)
		}
		consoleReply(w, map[string]any{"items": []any{map[string]any{"id": fixtureKeyID, "key": "sk-managed", "cost": "0.000000000000000001", "channel_cost": "private", "quota": "1.000000000000000001", "usage_known": false}}, "total": 1, "page": 1})
	})
	for _, path := range []string{"/api/token/", "/api/log/self?workspace=all"} {
		w := consoleCall(binding, "GET", path, "")
		body := w.Body.String()
		if w.Code != 200 || strings.Contains(body, "sk-managed") || strings.Contains(body, "private") || !strings.Contains(body, "000000000000000001") {
			t.Fatalf("scope/redaction/decimal failure: %d %s", w.Code, body)
		}
		if path == "/api/token/" && !strings.Contains(body, `"desktop_managed":true`) {
			t.Fatal("managed key was not marked read-only")
		}
	}
}

func TestConsolePersonalKeyOwnerPreflight(t *testing.T) {
	var mutations atomic.Int32
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			mutations.Add(1)
		}
		w.WriteHeader(404)
		_ = json.NewEncoder(w).Encode(envelope{Message: "not yours"})
	})
	for _, method := range []string{"PUT", "DELETE"} {
		path, body := "/api/token/"+fixtureKeyID, ""
		if method == "PUT" {
			path, body = "/api/token/", `{"id":"`+fixtureKeyID+`","status":2}`
		}
		if w := consoleCall(binding, method, path, body); w.Code != 404 {
			t.Fatalf("ownership refusal lost: %d %s", w.Code, w.Body.String())
		}
	}
	if mutations.Load() != 0 {
		t.Fatal("non-owner key mutation reached platform-privileged upstream")
	}
}

func TestConsoleTeamMembershipAndPlatformMemberScope(t *testing.T) {
	role := 0
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/team/team_fixture":
			consoleReply(w, map[string]any{"id": "team_fixture", "role": role, "status": 1, "platform_access": true, "balance": "100.00"})
		case "/api/user/self":
			consoleReply(w, map[string]any{"id": "user_self", "role": 100})
		case "/api/team/team_fixture/logs":
			if r.URL.Query().Get("user_id") != "user_self" {
				t.Error("member log filter was not forced to self")
			}
			consoleReply(w, map[string]any{"items": []any{}, "total": 0})
		default:
			t.Errorf("unexpected team route reached service: %s", r.URL)
		}
	})
	if w := consoleCall(binding, "GET", "/api/team/team_fixture", ""); w.Code != 403 {
		t.Fatal("non-member platform account inspected team")
	}
	role = 1
	if w := consoleCall(binding, "GET", "/api/team/team_fixture", ""); w.Code != 200 || strings.Contains(w.Body.String(), "balance") || strings.Contains(w.Body.String(), "platform_access") {
		t.Fatalf("member received platform wallet view: %s", w.Body.String())
	}
	if w := consoleCall(binding, "GET", "/api/team/team_fixture/logs?user_id=other", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := consoleCall(binding, "GET", "/api/team/team_fixture/usage", ""); w.Code != 403 {
		t.Fatal("platform-wide member aggregate was exposed")
	}
}

func TestConsoleBindingIgnoresSetupButRejectsReplacement(t *testing.T) {
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) { consoleReply(w, map[string]any{"id": "user_self"}) })
	mu.Lock()
	s, _ := readAccount()
	s.KeyHash = "repaired-key"
	_ = writeAccount(s)
	_ = saveWallet("fixture-jwt", "", s)
	mu.Unlock()
	if got, err := ConsoleBinding(context.Background()); err != nil || got != binding {
		t.Fatalf("setup/refresh invalidated login binding: %s %v", got, err)
	}
	mu.Lock()
	s.At = s.At.Add(time.Second)
	_ = writeAccount(s)
	mu.Unlock()
	if w := consoleCall(binding, "GET", "/api/user/self", ""); w.Code != 401 {
		t.Fatal("old capability survived a replacement login")
	}
}

func TestConsoleNeverReplaysFinancialMutation(t *testing.T) {
	var writes atomic.Int32
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			consoleReply(w, map[string]any{"id": "user_self"})
			return
		}
		writes.Add(1)
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(envelope{Message: "payment result uncertain"})
	})
	if w := consoleCall(binding, "POST", "/api/payment/orders", `{"amount":"12.500001"}`); w.Code != 503 || writes.Load() != 1 {
		t.Fatalf("financial POST was replayed: %d writes=%d", w.Code, writes.Load())
	}
}

func TestConsoleReplacementBetweenOwnerPreflightAndMutation(t *testing.T) {
	var writes atomic.Int32
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writes.Add(1)
		}
		if r.URL.Path == "/api/token/"+fixtureKeyID {
			mu.Lock()
			s, _ := readAccount()
			s.At = s.At.Add(time.Second)
			_ = writeAccount(s)
			mu.Unlock()
			consoleReply(w, map[string]any{"id": fixtureKeyID, "key": "sk-unmanaged"})
			return
		}
		consoleReply(w, map[string]any{})
	})
	w := consoleCall(binding, "PUT", "/api/token/", `{"id":"`+fixtureKeyID+`","status":2}`)
	if w.Code != 401 || writes.Load() != 0 {
		t.Fatalf("old login mutated after replacement: %d writes=%d", w.Code, writes.Load())
	}
}

func TestConsoleDropsTeamDataWhenRoleChangesDuringRead(t *testing.T) {
	var role atomic.Int32
	role.Store(3)
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/team/team_fixture" {
			consoleReply(w, map[string]any{"id": "team_fixture", "role": role.Load(), "status": 1})
			return
		}
		if r.URL.Path == "/api/team/team_fixture/logs" {
			role.Store(1)
			consoleReply(w, map[string]any{"items": []any{map[string]any{"model": "other-member-private"}}, "total": 1})
			return
		}
		t.Fatalf("unexpected read: %s", r.URL.Path)
	})
	w := consoleCall(binding, "GET", "/api/team/team_fixture/logs", "")
	if w.Code != 403 || strings.Contains(w.Body.String(), "other-member-private") {
		t.Fatalf("demoted member received old privileged data: %d %s", w.Code, w.Body.String())
	}
}

func TestConsolePlaygroundCannotMixWorkspaces(t *testing.T) {
	var posts atomic.Int32
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts.Add(1)
		}
		if r.URL.Path == "/api/team/team_fixture" {
			consoleReply(w, map[string]any{"id": "team_fixture", "role": 1, "status": 1})
			return
		}
		consoleReply(w, map[string]any{"id": fixtureKeyID, "team_id": "team_other", "key": "sk-unmanaged"})
	})
	for _, path := range []string{
		"/api/playground/chat?workspace_id=team_fixture",
		"/api/playground/chat?workspace_id=personal&token_id=" + fixtureKeyID,
		"/api/playground/chat?workspace_id=team_fixture&token_id=" + fixtureKeyID,
	} {
		if w := consoleCall(binding, "POST", path, `{"model":"fixture","messages":[],"stream":true}`); w.Code != 403 {
			t.Fatalf("workspace mismatch accepted: %s %d %s", path, w.Code, w.Body.String())
		}
	}
	if posts.Load() != 0 {
		t.Fatal("mismatched Playground sent a paid request")
	}
}

func TestConsoleStreamingStopsWhenReaderCancels(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			consoleReply(w, map[string]any{"id": "user_self"})
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"delta\":\"first\"}\n\n"))
		_ = http.NewResponseController(w).Flush()
		close(started)
		<-r.Context().Done()
		close(stopped)
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		r := httptest.NewRequest("POST", "/api/playground/chat?workspace_id=personal", strings.NewReader(`{"model":"fixture","messages":[],"stream":true}`)).WithContext(ctx)
		ConsoleServe(httptest.NewRecorder(), r, binding)
	}()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("stream never started")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		t.Fatal("client abort did not cancel upstream billing stream")
	}
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("stream handler outlived canceled request")
	}
}
