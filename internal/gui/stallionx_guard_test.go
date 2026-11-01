package gui

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/stallionx"
)

func TestStallionWorkspaceRequiresReadyUser(t *testing.T) {
	for _, tt := range []struct {
		name string
		user stallionx.UserStatus
		code int
		err  string
	}{
		{"signed out", stallionx.UserStatus{State: "signed_out"}, 401, "user_session_required"},
		{"expired", stallionx.UserStatus{State: "expired"}, 401, "user_session_required"},
		{"unavailable", stallionx.UserStatus{State: "unavailable"}, 503, "user_service_unavailable"},
		{"setup failed", stallionx.UserStatus{State: "authenticated", Setup: "failed"}, 409, "user_setup_required"},
		{"provider missing", stallionx.UserStatus{State: "authenticated", Setup: "ready"}, 409, "user_setup_required"},
		{"unknown", stallionx.UserStatus{}, 401, "user_session_required"},
		{"ready", stallionx.UserStatus{State: "authenticated", Setup: "ready", ProviderConnected: true}, 204, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			called := 0
			h := stallionxWorkspaceGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called++
				w.WriteHeader(http.StatusNoContent)
			}), func(context.Context) stallionx.UserStatus { return tt.user })
			for _, path := range []string{"/api/state", "/api/settings", "/api/providers", "/api/agents", "/api/stallionx/new-operation", pluginPagePrefix + "token/index.html", pluginPagePrefix + "token/" + pageServicePath + "requests"} {
				for _, method := range []string{"GET", "POST", "PUT", "DELETE"} {
					r := httptest.NewRecorder()
					h.ServeHTTP(r, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
					if r.Code != tt.code {
						t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
					}
					if tt.err != "" {
						var body map[string]string
						if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || body["code"] != tt.err || body["state"] != tt.user.State {
							t.Fatalf("%s %s: %s", method, path, r.Body.String())
						}
						if called != 0 || r.Header().Get("Cache-Control") != "no-store" {
							t.Fatalf("refused request reached workspace or was cacheable: called=%d headers=%v", called, r.Header())
						}
					}
				}
			}
			if tt.err == "" && called != 28 {
				t.Fatalf("ready user reached %d of 28 workspace routes", called)
			}
		})
	}
}

func TestStallionWorkspaceBootstrapIsExact(t *testing.T) {
	h := stallionxWorkspaceGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), func(context.Context) stallionx.UserStatus { return stallionx.UserStatus{State: "signed_out"} })
	for method, paths := range map[string][]string{
		"GET":  {"/api/stallionx", "/api/stallionx/user", "/api/fonts", "/api/omarchy", "/api/dev/wait", "/api/stallionx/wallet/balance", "/api/stallionx/wallet/config", "/api/stallionx/wallet/orders", "/api/stallionx/wallet/logs", "/api/stallionx/wallet/keys"},
		"POST": {"/api/stallionx/code", "/api/stallionx/signin", "/api/stallionx/signout", "/api/stallionx/sync", "/api/stallionx/repair", "/api/stallionx/wallet/create", "/api/stallionx/wallet/redeem", "/api/window/hide", "/api/window/main", "/api/window/quit", "/api/window/fit", "/api/window/tint", "/api/window/titlebar"},
	} {
		for _, path := range paths {
			for _, tt := range []struct {
				method, path string
				status       int
			}{
				{method, path, 204}, {method, path + "/extra", 401}, {"DELETE", path, 401},
			} {
				r := httptest.NewRecorder()
				h.ServeHTTP(r, httptest.NewRequest(tt.method, tt.path, nil))
				if r.Code != tt.status {
					t.Fatalf("%s %s: %d, want %d", tt.method, tt.path, r.Code, tt.status)
				}
			}
		}
	}
	for _, path := range []string{"/", "/boot.js", "/stallionx-user.js", "/stallionx-user.css"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 204 {
			t.Fatalf("login asset %s refused: %d", path, r.Code)
		}
	}
}

func TestStallionLoginOpensOnlyLegalPages(t *testing.T) {
	for _, tt := range []struct {
		name, body string
		allowed    bool
	}{
		{"terms", `{"url":"` + stallionx.Base() + `/terms"}`, true},
		{"privacy", `{"url":"` + stallionx.Base() + `/privacy"}`, true},
		{"elsewhere", `{"url":"https://example.com"}`, false},
		{"local", `{"url":"http://localhost:1234"}`, false},
		{"app scheme", `{"url":"vscode://file/etc/passwd"}`, false},
		{"file", `{"url":"file:///etc/passwd"}`, false},
		{"legal sibling", `{"url":"` + stallionx.Base() + `/terms/extra"}`, false},
		{"legal query", `{"url":"` + stallionx.Base() + `/terms?redirect=elsewhere"}`, false},
		{"malformed", `{"url":`, false},
		{"oversized", `{"url":"` + strings.Repeat("x", 32<<10) + `"}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/open", strings.NewReader(tt.body))
			if got := stallionxBeforeLogin(r); got != tt.allowed {
				t.Fatalf("allowed=%v, want %v", got, tt.allowed)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != tt.body {
				t.Fatalf("launcher request body changed: %v", err)
			}
		})
	}
	r := httptest.NewRequest("POST", "/api/open", nil)
	r.Body = nil
	if stallionxBeforeLogin(r) {
		t.Fatal("empty launcher request was allowed")
	}
}

func TestStallionSetupFailureCanOpenAuthenticatedCheckout(t *testing.T) {
	for _, state := range []string{"authenticated", "signed_out", "expired", "unavailable"} {
		for _, target := range []string{
			"https://checkout.stripe.com/c/pay/cs_test_example",
			"https://checkout.stripe.com.attacker.example/c/pay/test",
			"https://checkout.stripe.com@attacker.example/c/pay/test",
			"https://user@checkout.stripe.com/c/pay/test",
			"https://checkout.stripe.com:444/c/pay/test",
			"http://checkout.stripe.com/c/pay/test",
			"http://localhost:1234",
			"vscode://file/etc/passwd",
			stallionx.Base() + "/admin",
		} {
			body, _ := json.Marshal(map[string]string{"url": target})
			called := false
			h := stallionxWorkspaceGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				got, err := io.ReadAll(r.Body)
				if err != nil || string(got) != string(body) {
					t.Fatalf("checkout body changed: %s, %v", got, err)
				}
				w.WriteHeader(http.StatusNoContent)
			}), func(context.Context) stallionx.UserStatus {
				return stallionx.UserStatus{State: state, Setup: "failed"}
			})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("POST", "/api/open", strings.NewReader(string(body))))
			allowed := state == "authenticated" && target == "https://checkout.stripe.com/c/pay/cs_test_example"
			if called != allowed || (w.Code == 204) != allowed {
				t.Fatalf("%s opening %s: called=%v status=%d", state, target, called, w.Code)
			}
		}
	}
}

// The irreversible product bootstrap runs in its own process so the reusable
// upstream handler tests retain their original standalone behavior.
func TestStallionRequiredUserGuardsGUIHandler(t *testing.T) {
	const child = "MAGPIE_TEST_STALLION_GUI_REQUIRED"
	if os.Getenv(child) != "1" {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := proc.Command(exe, "-test.run=^TestStallionRequiredUserGuardsGUIHandler$")
		cmd.Env = append(os.Environ(), child+"=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("required-user GUI: %v\n%s", err, out)
		}
		return
	}
	stallionx.EnableRequiredUser()
	h := builtinHome(t)
	for _, path := range []string{"/api/state", "/api/settings", "/api/providers", "/api/agents", pluginPagePrefix + "token/index.html", pluginPagePrefix + "token/" + pageServicePath + "requests"} {
		for _, method := range []string{"GET", "POST"} {
			r := httptest.NewRecorder()
			h.ServeHTTP(r, httptest.NewRequest(method, path, strings.NewReader(`{}`)))
			if r.Code != 401 || !strings.Contains(r.Body.String(), `"code":"user_session_required"`) {
				t.Fatalf("handler left %s %s open: %d %s", method, path, r.Code, r.Body.String())
			}
		}
	}
	for _, path := range []string{"/", "/stallionx-user.js", "/api/stallionx/user"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 200 {
			t.Fatalf("login bootstrap %s: %d %s", path, r.Code, r.Body.String())
		}
	}
}
