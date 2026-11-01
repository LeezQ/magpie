package gateway

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tidwall/gjson"
	"github.com/yetone/magpie/internal/provider"
)

func TestStallionXBalanceRefusalReachesAgents(t *testing.T) {
	for _, payer := range []struct{ name, message, hint string }{
		{"personal", "Insufficient balance", "余额不足，请在 StallionX 用户中心充值后重试。"},
		{"team", "Insufficient team balance", "团队余额不足，请联系团队所有者为团队钱包充值后重试。"},
	} {
		for _, wire := range []struct{ name, path, input string }{
			{"chat", "/v1/chat/completions", `"messages":[{"role":"user","content":"hi"}]`},
			{"responses", "/v1/responses", `"input":"hi"`},
			{"anthropic", "/v1/messages", `"messages":[{"role":"user","content":"hi"}],"max_tokens":16`},
		} {
			for _, stream := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/stream=%v", payer.name, wire.name, stream), func(t *testing.T) {
					fresh(t)
					var requests atomic.Int32
					up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						requests.Add(1)
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusForbidden)
						fmt.Fprintf(w, `{"success":false,"message":%q}`, payer.message)
					}))
					t.Cleanup(up.Close)
					id := "stallionx"
					if payer.name == "team" {
						id += "-team-fixture"
					}
					if err := provider.Save(provider.Provider{ID: id, Preset: provider.StallionXPreset, Name: "StallionX", Key: "fixture-key", Chat: up.URL + "/v1", Models: []string{"m"}}); err != nil {
						t.Fatal(err)
					}
					s := New()
					s.Unrest(id)
					t.Cleanup(func() { s.Unrest(id) })
					gw := httptest.NewServer(s.Front())
					t.Cleanup(gw.Close)
					body := fmt.Sprintf(`{"model":%q,"stream":%v,%s}`, id+"/m", stream, wire.input)
					// The third and fourth replies come from quotaHeld, not the vendor.
					for attempt := 0; attempt < 4; attempt++ {
						if attempt == 3 {
							restartRests()
						}
						res, err := http.Post(gw.URL+wire.path, "application/json", strings.NewReader(body))
						if err != nil {
							t.Fatal(err)
						}
						b, err := io.ReadAll(res.Body)
						res.Body.Close()
						if err != nil {
							t.Fatal(err)
						}
						if res.StatusCode != 402 || !strings.Contains(string(b), payer.hint) || !strings.Contains(string(b), payer.message) || strings.Contains(string(b), "permission_error") || strings.Contains(string(b), "authentication_error") {
							t.Fatalf("balance failure must be payment-required, not authentication: %d %s", res.StatusCode, b)
						}
						want := "stallionx_insufficient_balance"
						if payer.name == "team" {
							want = "stallionx_insufficient_team_balance"
						}
						if code := gjson.GetBytes(b, "error.code").String(); code != want {
							t.Fatalf("billing code lost: %s, want %s", code, want)
						}
						if display := gjson.GetBytes(b, "error.displayMsg.zh-cn").String(); display != payer.hint {
							t.Fatalf("WorkBuddy needs a localized title, not its default login-expired banner: %s", b)
						}
					}
					if got := requests.Load(); got != 2 {
						t.Fatalf("got %d upstream requests, want two refusals followed by two cached replies", got)
					}
				})
			}
		}
	}
}

func TestStallionXRefusalKeepsAuthenticationAndPermissions(t *testing.T) {
	for _, tc := range []struct {
		name, message, preset string
		status                int
	}{
		{"bad key", "Invalid API key", provider.StallionXPreset, 401},
		{"disabled account", "Account is disabled", provider.StallionXPreset, 403},
		{"key quota", "This API key's quota is exhausted", provider.StallionXPreset, 403},
		{"other provider balance", "Insufficient balance", "other", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fresh(t)
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				fmt.Fprintf(w, `{"success":false,"message":%q}`, tc.message)
			}))
			t.Cleanup(up.Close)
			if err := provider.Save(provider.Provider{ID: "fixture", Preset: tc.preset, Name: "Fixture", Key: "fixture-key", Chat: up.URL + "/v1", Models: []string{"m"}}); err != nil {
				t.Fatal(err)
			}
			s := New()
			code, body := postAs(t, s, "", `{"model":"fixture/m","messages":[{"role":"user","content":"hi"}]}`)
			if code != tc.status || gjson.Get(body, "error.message").String() != "Fixture: "+tc.message {
				t.Fatalf("unrelated refusal changed: %d %s", code, body)
			}
		})
	}
}
