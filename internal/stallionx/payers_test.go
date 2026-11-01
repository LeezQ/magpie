package stallionx

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

// teamFake is fakeService with teams: GET /api/team/mine, and a provision
// with team_id answered the way Stallion-X does (a team key per team,
// reuse_only, and data.reason on a refusal).
type teamFake struct {
	fakeService
	lock sync.Mutex
	// teams is what /api/team/mine lists.
	teams []map[string]any
	// keys are the team keys on the service, by team id; absent: none yet.
	keys map[string]string
	// off are the teams whose key a team admin disabled.
	off map[string]bool
	// refuse answers every provision of that team with this reason.
	refuse map[string]string
	// personalDown fails the personal provision (no team_id).
	personalDown bool
	// asks are the team provisions, as "team_id" or "team_id reuse".
	asks []string
}

func (f *teamFake) server(t *testing.T) {
	t.Helper()
	reset := func() {
		if _, err := SignOut(); err != nil {
			t.Fatal(err)
		}
	}
	reset()
	t.Cleanup(reset)
	f.codes = map[string]string{}
	base := f.handler(t)
	reply := func(w http.ResponseWriter, status int, ok bool, msg string, data any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"success": ok, "message": msg, "data": data})
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.lock.Lock()
		defer f.lock.Unlock()
		switch r.URL.Path {
		case "/api/team/mine":
			reply(w, 200, true, "", f.teams)
			return
		case "/api/cli/provision":
			b, _ := io.ReadAll(r.Body)
			var in struct {
				Name      string `json:"name"`
				TeamID    string `json:"team_id"`
				ReuseOnly bool   `json:"reuse_only"`
			}
			json.Unmarshal(b, &in)
			if in.TeamID == "" {
				if f.personalDown {
					reply(w, 503, false, "fixture unavailable", nil)
					return
				}
				r.Body = io.NopCloser(bytes.NewReader(b))
				break
			}
			ask := in.TeamID
			if in.ReuseOnly {
				ask += " reuse"
			}
			f.asks = append(f.asks, ask)
			if why := f.refuse[in.TeamID]; why != "" {
				reply(w, 403, false, "团队不可用", map[string]string{"reason": why})
				return
			}
			if f.off[in.TeamID] {
				reply(w, 409, false, "团队 Key 已被禁用", map[string]string{"reason": "team_key_disabled"})
				return
			}
			key, ok := f.keys[in.TeamID]
			if !ok && in.ReuseOnly {
				reply(w, 404, false, "Key 不存在", map[string]string{"reason": "key_not_found"})
				return
			}
			if !ok {
				key = "sk-team-" + in.TeamID
				f.keys[in.TeamID] = key
			}
			var team map[string]any
			for _, tm := range f.teams {
				if tm["id"] == in.TeamID {
					team = tm
				}
			}
			reply(w, 200, true, "", map[string]any{"key": key, "token_id": "tok_" + in.TeamID, "team": team})
			return
		}
		base.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL)
}

func (f *teamFake) set(change func()) { f.lock.Lock(); change(); f.lock.Unlock() }

func (f *teamFake) asked() []string {
	f.lock.Lock()
	defer f.lock.Unlock()
	return slices.Clone(f.asks)
}

func newTeamFake() *teamFake {
	return &teamFake{
		teams: []map[string]any{
			{"id": "team_alpha", "name": "Alpha", "role": 3, "status": 1, "member_quota": map[string]any{"quota": "50", "used_amount": "10", "remaining_quota": "40"}},
			{"id": "team_beta", "name": "Beta", "role": 2, "status": 1, "balance": "300"},
		},
		keys: map[string]string{}, off: map[string]bool{}, refuse: map[string]string{},
	}
}

func payerOf(t *testing.T, l PayerList, id string) Payer {
	t.Helper()
	for _, p := range l.Payers {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("no payer %s in %+v", id, l.Payers)
	return Payer{}
}

func signIn(t *testing.T, email string) {
	t.Helper()
	ctx := context.Background()
	if _, err := SendCode(ctx, email, "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, email, "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
}

// A team key is made only by the user's click: signing in and syncing never
// ask for one, enabling a team does, and the sync after only reuses it.
func TestTeamKeyIsCreatedOnlyWhenEnabled(t *testing.T) {
	f := newTeamFake()
	f.server(t)
	ctx := context.Background()
	signIn(t, "alice@example.com")
	SyncAccount(ctx)
	if got := f.asked(); len(got) != 0 {
		t.Fatalf("sign-in asked for team keys: %v", got)
	}
	l, err := ListPayers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !l.Ask || len(l.Payers) != 3 {
		t.Fatalf("payers: %+v", l)
	}
	if p := payerOf(t, l, PersonalPayer); p.State != stateReady || !p.Default || !p.Enabled {
		t.Fatalf("personal: %+v", p)
	}
	if p := payerOf(t, l, "team_alpha"); p.Enabled || p.State != stateNotEnabled || !strings.Contains(string(p.Wallet), `"remaining_quota"`) {
		t.Fatalf("alpha before enabling: %+v", p)
	}
	if p := payerOf(t, l, "team_beta"); !strings.Contains(string(p.Wallet), `"balance"`) {
		t.Fatalf("an admin's wallet is the team balance: %+v", p)
	}
	if _, err := provider.Find(teamProviderID("team_alpha")); err == nil {
		t.Fatal("a team provider exists before the user enabled the team")
	}

	l, err = EnablePayer(ctx, "team_alpha")
	if err != nil {
		t.Fatal(err)
	}
	if p := payerOf(t, l, "team_alpha"); !p.Enabled || p.State != stateReady {
		t.Fatalf("alpha after enabling: %+v", p)
	}
	p, err := provider.Find(teamProviderID("team_alpha"))
	if err != nil || p.Key != "sk-team-team_alpha" || p.Name != "StallionX · Alpha" || !provider.StallionXTeamPayer(*p) {
		t.Fatalf("team provider: %+v, %v", p, err)
	}
	if personal, err := provider.Find(ProviderID); err != nil || personal.Key != "sk-stallionx-test" {
		t.Fatalf("enabling a team touched the personal provider: %+v, %v", personal, err)
	}
	SyncAccount(ctx)
	if got := f.asked(); !slices.Equal(got, []string{"team_alpha", "team_alpha reuse"}) {
		t.Fatalf("team provisions: %v", got)
	}
}

// When a team admin disables or deletes the desktop's team key, the sync
// says so and never makes a new one; the provider stays for the user to
// move their agents off.
func TestTeamSyncRecordsWhyAndNeverRecreates(t *testing.T) {
	f := newTeamFake()
	f.server(t)
	ctx := context.Background()
	signIn(t, "alice@example.com")
	if _, err := EnablePayer(ctx, "team_alpha"); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		change func()
		want   string
	}{
		{func() { f.off["team_alpha"] = true }, stateKeyDisabled},
		{func() { delete(f.off, "team_alpha"); delete(f.keys, "team_alpha") }, stateKeyMissing},
		{func() { f.refuse["team_alpha"] = "not_team_member" }, stateNotTeamMember},
		{func() { f.refuse["team_alpha"] = "team_disbanded" }, stateTeamDisbanded},
	} {
		f.set(c.change)
		SyncAccount(ctx)
		l, err := ListPayers(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if p := payerOf(t, l, "team_alpha"); p.State != c.want || p.Message == "" {
			t.Fatalf("want %s: %+v", c.want, p)
		}
		if _, err := provider.Find(teamProviderID("team_alpha")); err != nil {
			t.Fatalf("the sync removed the team provider at %s: %v", c.want, err)
		}
	}
	f.lock.Lock()
	_, made := f.keys["team_alpha"]
	f.lock.Unlock()
	if made {
		t.Fatal("the sync made a new team key after an admin deleted it")
	}
	// the team's own status is fresher than the last sync
	f.set(func() { delete(f.refuse, "team_alpha"); f.teams[0]["status"] = teamStatusDisabled })
	l, _ := ListPayers(ctx)
	if p := payerOf(t, l, "team_alpha"); p.State != stateTeamDisabled {
		t.Fatalf("a disabled team: %+v", p)
	}
}

// A member whose personal setup failed works on the team's wallet.
func TestTeamPayerOpensTheWorkspace(t *testing.T) {
	f := newTeamFake()
	f.personalDown = true
	f.server(t)
	ctx := context.Background()
	signIn(t, "alice@example.com")
	if st := User(ctx); st.Setup == "ready" {
		t.Fatalf("ready with no payer: %+v", st)
	}
	if _, err := EnablePayer(ctx, "team_alpha"); err != nil {
		t.Fatal(err)
	}
	st := User(ctx)
	if st.State != "authenticated" || st.Setup != "ready" || !st.PayerReady || !st.ProviderConnected {
		t.Fatalf("a ready team payer: %+v", st)
	}
	// and it stays open through a sync whose personal provision still fails
	if st := SyncAccount(ctx); st.Setup != "ready" || !st.PayerReady {
		t.Fatalf("after a sync: %+v", st)
	}
}

// Choosing a default enables that team, records the answer and puts its
// provider first; removing the team brings the default back to personal.
func TestDefaultPayer(t *testing.T) {
	f := newTeamFake()
	f.server(t)
	ctx := context.Background()
	signIn(t, "alice@example.com")
	l, err := SetDefaultPayer(ctx, "team_beta")
	if err != nil {
		t.Fatal(err)
	}
	if l.Ask {
		t.Fatal("asked again after the user answered")
	}
	if p := payerOf(t, l, "team_beta"); !p.Default || !p.Enabled || p.State != stateReady {
		t.Fatalf("beta as default: %+v", p)
	}
	if p := payerOf(t, l, PersonalPayer); p.Default {
		t.Fatalf("personal still default: %+v", p)
	}
	if order, err := provider.StoredOrder(); err != nil || len(order) == 0 || order[0] != teamProviderID("team_beta") {
		t.Fatalf("order: %v, %v", order, err)
	}
	// signing in again as the same account keeps the answer and the team
	signIn(t, "alice@example.com")
	if l, _ = ListPayers(ctx); l.Ask || !payerOf(t, l, "team_beta").Default || !payerOf(t, l, "team_beta").Enabled {
		t.Fatalf("after signing in again: %+v", l)
	}
	if l, err = RemovePayer(ctx, "team_beta"); err != nil {
		t.Fatal(err)
	}
	if p := payerOf(t, l, PersonalPayer); !p.Default {
		t.Fatalf("personal not default after removing the default team: %+v", l)
	}
	if _, err := provider.Find(teamProviderID("team_beta")); err == nil {
		t.Fatal("removed team's provider is still here")
	}
	if _, err := SetDefaultPayer(ctx, "../evil"); err == nil {
		t.Fatal("took a payer id that isn't a team's")
	}
}

// A team's key goes with the account: signing out, or signing in as
// someone else, removes it, but never a provider the user edited by hand.
func TestTeamProvidersGoWithTheAccount(t *testing.T) {
	f := newTeamFake()
	f.server(t)
	ctx := context.Background()
	signIn(t, "alice@example.com")
	for _, id := range []string{"team_alpha", "team_beta"} {
		if _, err := EnablePayer(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	// beta edited by hand: not ours any more
	p, err := provider.Find(teamProviderID("team_beta"))
	if err != nil {
		t.Fatal(err)
	}
	p.Key = "sk-users-own"
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	SyncAccount(ctx)
	l, _ := ListPayers(ctx)
	if b := payerOf(t, l, "team_beta"); b.State != stateConflict || b.Enabled {
		t.Fatalf("a hand-edited team provider: %+v", b)
	}
	if p, _ := provider.Find(teamProviderID("team_beta")); p == nil || p.Key != "sk-users-own" {
		t.Fatalf("the sync overwrote a hand-edited team provider: %+v", p)
	}
	if _, err := EnablePayer(ctx, "team_beta"); err == nil {
		t.Fatal("enabling overwrote a hand-edited team provider")
	}

	signIn(t, "bob@example.com")
	if _, err := provider.Find(teamProviderID("team_alpha")); err == nil {
		t.Fatal("another account's team key stayed after a new sign-in")
	}
	if p, _ := provider.Find(teamProviderID("team_beta")); p == nil || p.Key != "sk-users-own" {
		t.Fatal("a sign-in removed a hand-edited provider")
	}
	if l, _ := ListPayers(ctx); !l.Ask || payerOf(t, l, "team_alpha").Enabled {
		t.Fatalf("bob inherited alice's payers: %+v", l)
	}

	if _, err := EnablePayer(ctx, "team_alpha"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Find(teamProviderID("team_alpha")); err == nil {
		t.Fatal("a team key stayed after signing out")
	}
	if p, _ := provider.Find(teamProviderID("team_beta")); p == nil {
		t.Fatal("sign-out removed a hand-edited provider")
	}
	if err := provider.Delete(teamProviderID("team_beta")); err != nil {
		t.Fatal(err)
	}
}

// The console doesn't let the desktop's team key be edited or deleted,
// matched by its id or, when the list shows it, its plaintext.
func TestDesktopTeamKey(t *testing.T) {
	s := saved{Teams: map[string]teamSaved{"team_alpha": {KeyHash: keyHash("sk-team"), TokenID: "tok_1"}}}
	raw := func(v string) json.RawMessage { b, _ := json.Marshal(v); return b }
	if !desktopTeamKey(s, map[string]json.RawMessage{"id": raw("tok_1")}) {
		t.Fatal("missed by id")
	}
	if !desktopTeamKey(s, map[string]json.RawMessage{"id": raw("tok_9"), "key": raw("sk-team")}) {
		t.Fatal("missed by key")
	}
	if desktopTeamKey(s, map[string]json.RawMessage{"id": raw("tok_2"), "key": raw("sk-other")}) || desktopTeamKey(saved{}, map[string]json.RawMessage{"id": raw("")}) {
		t.Fatal("matched another key")
	}
}
