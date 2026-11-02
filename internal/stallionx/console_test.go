package stallionx

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/catalog"
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
		// a provider reads its model list with its own key, as an agent's
		// request does (refreshDesktopModels); the handler checks which key
		if r.URL.Path == "/v1/models" || r.URL.Path == "/models" {
			handler(w, r)
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

// The desktop app's own keys, the account's and a team payer's, are edited in
// the console like any other key (reported: saving the team "StallionX 客户端"
// key's channel groups was refused as "This key manages desktop access").
// They are never renamed or deleted there, as the app finds its key again by
// name, and a save fetches that key's provider's models again, so Providers
// lists what the key gives now. Every route that reaches a key is covered:
// the key form's PUT /api/token/ (personal and team alike) and the key table's
// team routes.
func TestConsoleDesktopKeysEditButNeverRenameOrDelete(t *testing.T) {
	const teamKeyID = "key_fedcba9876543210fedcba9876543210"
	const otherKeyID = "key_00000000000000000000000000000001"
	var state sync.Mutex
	var writes []string // every mutation that reached the service
	listed := map[string][]string{"sk-managed": {"m1"}, "sk-team": {"t1"}}
	off := map[string]bool{} // keys switched off: the service refuses their model list
	fetches := map[string]int{}
	keys := map[string]map[string]any{
		fixtureKeyID: {"id": fixtureKeyID, "key": "sk-managed", "name": tokenName, "team_id": ""},
		teamKeyID:    {"id": teamKeyID, "key": "sk-team", "name": tokenName, "team_id": "team_alpha"},
		otherKeyID:   {"id": otherKeyID, "key": "sk-other", "name": "Scripts", "team_id": ""},
	}
	binding := consoleFixture(t, func(w http.ResponseWriter, r *http.Request) {
		state.Lock()
		defer state.Unlock()
		switch {
		case r.URL.Path == "/v1/models":
			key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			fetches[key]++
			if off[key] {
				w.WriteHeader(401)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": "key disabled"}})
				return
			}
			var data []map[string]string
			for _, id := range listed[key] {
				data = append(data, map[string]string{"id": id, "object": "model"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/token/key_"):
			consoleReply(w, keys[strings.TrimPrefix(r.URL.Path, "/api/token/")])
		case r.URL.Path == "/api/team/team_alpha":
			consoleReply(w, map[string]any{"id": "team_alpha", "role": 3, "status": 1})
		case r.URL.Path == "/api/team/team_alpha/tokens":
			consoleReply(w, map[string]any{"items": []any{keys[teamKeyID], map[string]any{"id": "key_00000000000000000000000000000002", "key": "sk-colleague", "name": tokenName, "team_id": "team_alpha"}}, "total": 2})
		case r.URL.Path == "/api/user/self":
			consoleReply(w, map[string]any{"id": "user_fixture"})
		case r.Method == "GET":
			consoleReply(w, map[string]any{})
		default:
			body, _ := io.ReadAll(r.Body)
			writes = append(writes, r.Method+" "+r.URL.Path+" "+string(body))
			var in struct {
				ID     string   `json:"id"`
				Status int      `json:"status"`
				Groups []string `json:"channel_group_ids"`
			}
			_ = json.Unmarshal(body, &in)
			if in.Status == 9 {
				w.WriteHeader(400)
				_ = json.NewEncoder(w).Encode(envelope{Message: "无效的令牌状态"})
				return
			}
			// the service's answer to new groups: the key lists their models
			if key, ok := keys[in.ID]; ok && in.Groups != nil {
				listed[key["key"].(string)] = in.Groups
			}
			if key, ok := keys[in.ID]; ok && in.Status != 0 {
				off[key["key"].(string)] = in.Status != 1
			}
			consoleReply(w, map[string]any{})
		}
	})
	mu.Lock()
	s, err := readAccount()
	if err == nil {
		s.Setup, s.ModelCount = "ready", 1
		s.Teams = map[string]teamSaved{"team_alpha": {Name: "Alpha", KeyHash: keyHash("sk-team"), TokenID: teamKeyID, ModelCount: 1}}
		err = writeAccount(s)
	}
	if err == nil {
		err = saveProvider(s.Service, "sk-managed", "")
	}
	if err == nil {
		err = saveTeamProvider(s, "team_alpha", "Alpha", "sk-team", "")
	}
	mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, want int) {
		t.Helper()
		if w := consoleCall(binding, method, path, body); w.Code != want {
			t.Fatalf("%s %s %s: %d %s, want %d", method, path, body, w.Code, w.Body.String(), want)
		}
	}
	counts := func() (personal, team int) {
		t.Helper()
		now, err := readAccount()
		if err != nil {
			t.Fatal(err)
		}
		return now.ModelCount, now.Teams["team_alpha"].ModelCount
	}
	live := func(id string) int {
		models, _, _ := catalog.Live(id)
		return len(models)
	}

	// the team list marks this computer's team key, not a colleague's of the same name
	w := consoleCall(binding, "GET", "/api/team/team_alpha/tokens", "")
	var list struct {
		Data struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || len(list.Data.Items) != 2 {
		t.Fatalf("team list: %d %s", w.Code, w.Body.String())
	}
	if list.Data.Items[0]["desktop_managed"] != true || list.Data.Items[1]["desktop_managed"] != nil {
		t.Fatalf("desktop team key marking: %v", list.Data.Items)
	}

	// no route deletes or renames either desktop key, and nothing reaches the service
	call("DELETE", "/api/token/"+fixtureKeyID, "", 403)
	call("DELETE", "/api/token/"+teamKeyID, "", 403)
	call("DELETE", "/api/team/team_alpha/tokens/"+teamKeyID, "", 403)
	call("PUT", "/api/token/", `{"id":"`+fixtureKeyID+`","name":"My laptop"}`, 403)
	call("PUT", "/api/token/", `{"id":"`+teamKeyID+`","name":"My laptop","status":1}`, 403)
	call("PUT", "/api/team/team_alpha/tokens/"+teamKeyID, `{"name":"My laptop"}`, 403)
	written := func() []string {
		state.Lock()
		defer state.Unlock()
		return append([]string(nil), writes...)
	}
	if got := written(); len(got) != 0 {
		t.Fatalf("a refused change reached the service: %v", got)
	}

	// the key form's save, with the name as it is: the personal provider lists the new groups' models
	call("PUT", "/api/token/", `{"id":"`+fixtureKeyID+`","name":"`+tokenName+`","channel_group_ids":["m1","m2","m3"],"models":null,"allowed_ips":["10.0.0.1"],"expires_at":null,"quota":5}`, 200)
	if p, team := counts(); p != 3 || team != 1 || live(ProviderID) != 3 {
		t.Fatalf("after the personal edit: personal %d (live %d), team %d", p, live(ProviderID), team)
	}
	// the team key through the same form (the reported case), its name padded as typed
	call("PUT", "/api/token/", `{"id":"`+teamKeyID+`","name":" `+tokenName+` ","channel_group_ids":["t1","t2"]}`, 200)
	if p, team := counts(); p != 3 || team != 2 || live(teamProviderID("team_alpha")) != 2 {
		t.Fatalf("after the team edit: personal %d, team %d (live %d)", p, team, live(teamProviderID("team_alpha")))
	}
	// how many times each key's list was asked for: a failed list is asked
	// again at other URLs (provider.Fetch), so tests compare, never count
	asked := func() map[string]int {
		state.Lock()
		defer state.Unlock()
		out := map[string]int{}
		for k, v := range fetches {
			out[k] = v
		}
		return out
	}
	// switched off from the table: the save stands, the failed refresh changes nothing recorded
	before := asked()
	call("PUT", "/api/team/team_alpha/tokens/"+teamKeyID, `{"id":"`+teamKeyID+`","status":2}`, 200)
	if _, team := counts(); team != 2 || asked()["sk-team"] <= before["sk-team"] {
		t.Fatalf("switching the team key off: team %d, asked %v then %v", team, before, asked())
	}
	// and on again: its models come back from the service
	call("PUT", "/api/team/team_alpha/tokens/"+teamKeyID, `{"id":"`+teamKeyID+`","status":1}`, 200)
	if _, team := counts(); team != 2 || live(teamProviderID("team_alpha")) != 2 {
		t.Fatalf("switching the team key on: team %d (live %d)", team, live(teamProviderID("team_alpha")))
	}
	// a save the service refuses refreshes nothing, and another key's change
	// (a new name too, and a delete) moves no provider
	before = asked()
	call("PUT", "/api/token/", `{"id":"`+fixtureKeyID+`","status":9}`, 400)
	call("PUT", "/api/token/", `{"id":"`+otherKeyID+`","name":"Renamed"}`, 200)
	call("DELETE", "/api/token/"+otherKeyID, "", 200)
	if after := asked(); len(after) != len(before) || after["sk-managed"] != before["sk-managed"] || after["sk-team"] != before["sk-team"] || after["sk-other"] != 0 {
		t.Fatalf("a refused save or another key refetched: %v then %v", before, after)
	}
	if got := written(); len(got) != 7 {
		t.Fatalf("writes: %v", got)
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
