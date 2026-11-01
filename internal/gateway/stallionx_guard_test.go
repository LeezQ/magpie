package gateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tidwall/gjson"

	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/stallionx"
)

func TestStallionGatewayRequiresReadyUser(t *testing.T) {
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
			h := stallionxAccountGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called++
				w.WriteHeader(http.StatusNoContent)
			}), func(context.Context) stallionx.UserStatus { return tt.user })
			for _, path := range []string{"/v1/chat/completions", "/responses", "/messages", "/v1/messages/count_tokens"} {
				r := httptest.NewRecorder()
				h.ServeHTTP(r, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
				if r.Code != tt.code {
					t.Fatalf("%s: %d %s", path, r.Code, r.Body.String())
				}
				if tt.err != "" {
					body := gjson.ParseBytes(r.Body.Bytes())
					anthropic := strings.Contains(path, "messages")
					if (!anthropic && body.Get("error.code").String() != tt.err) || body.Get("error.message").String() == "" {
						t.Fatalf("%s: %s", path, r.Body.String())
					}
					if anthropic && body.Get("type").String() != "error" {
						t.Fatalf("Anthropic error shape: %s", r.Body.String())
					}
					if called != 0 || r.Header().Get("Cache-Control") != "no-store" {
						t.Fatalf("refused request reached gateway or was cacheable: called=%d headers=%v", called, r.Header())
					}
				}
			}
			if tt.err == "" && called != 4 {
				t.Fatalf("ready user reached %d of 4 gateway routes", called)
			}
		})
	}
}

func TestStallionGatewayBootstrapIsExact(t *testing.T) {
	h := stallionxAccountGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), func(context.Context) stallionx.UserStatus { return stallionx.UserStatus{State: "signed_out"} })
	for method, paths := range map[string][]string{
		"GET":  {"/", "/v1", "/v1/", "/api/hello", "/api/version", GoroutinesPath, HeapPath, CPUPath},
		"POST": {RestartPath},
	} {
		for _, path := range paths {
			for _, tt := range []struct {
				method, path string
				code         int
			}{
				{method, path, 204}, {method, strings.TrimSuffix(path, "/") + "/extra", 401}, {"DELETE", path, 401},
			} {
				r := httptest.NewRecorder()
				h.ServeHTTP(r, httptest.NewRequest(tt.method, tt.path, nil))
				if r.Code != tt.code {
					t.Fatalf("%s %s: %d, want %d", tt.method, tt.path, r.Code, tt.code)
				}
			}
		}
	}
}

// A product process enables the boundary once, before serving. Keep it out of
// the upstream test process, but exercise the real Front/Handler/route stack.
func TestStallionRequiredUserGuardsEveryGatewayRoute(t *testing.T) {
	const child = "MAGPIE_TEST_STALLION_GATEWAY_REQUIRED"
	if os.Getenv(child) != "1" {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := proc.Command(exe, "-test.run=^TestStallionRequiredUserGuardsEveryGatewayRoute$")
		cmd.Env = append(os.Environ(), child+"=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("required-user gateway: %v\n%s", err, out)
		}
		return
	}
	fresh(t)
	stallionx.EnableRequiredUser()
	s := New()
	h := s.Front()
	for _, pattern := range s.routes().patterns {
		for _, request := range requestsFor(pattern) {
			r := httptest.NewRequest(request[0], "http://127.0.0.1:3425"+request[1], strings.NewReader(`{}`))
			r.RemoteAddr = "127.0.0.1:12345"
			if stallionxGatewayBootstrap(r) {
				continue
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 401 || gjson.GetBytes(w.Body.Bytes(), "error.message").String() != "Sign in to StallionX to use its gateway" {
				t.Fatalf("route %s, request %s %s: %d %s", pattern, request[0], request[1], w.Code, w.Body.String())
			}
		}
	}
	for _, path := range []string{"/", "/v1", "/api/hello", "/api/version"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:3425"+path, nil)
		r.RemoteAddr = "127.0.0.1:12345"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("gateway discovery %s: %d %s", path, w.Code, w.Body.String())
		}
	}
}

func TestStallionGatewayStopsNextSocketTurnAfterSignOut(t *testing.T) {
	fresh(t)
	u := &respUp{}
	sockUp(t, u)
	var signedOut atomic.Bool
	s := New()
	h := socketEntry(stallionxAccountGuard(s.Front(), func(context.Context) stallionx.UserStatus {
		if signedOut.Load() {
			return stallionx.UserStatus{State: "signed_out"}
		}
		return stallionx.UserStatus{State: "authenticated", Setup: "ready", ProviderConnected: true}
	}))
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s.sockets.drain(ctx)
	})
	c, _, err := dialSock(t, ts, "/v1/responses", nil)
	if err != nil {
		t.Fatal(err)
	}
	first := last(c.turn(create("", userHi)))
	if first.Get("type").String() != "response.completed" || u.calls() != 1 {
		t.Fatalf("signed-in turn failed: %s; upstream calls=%d", first.Raw, u.calls())
	}
	signedOut.Store(true)
	second := last(c.turn(create(first.Get("response.id").String(), userMore)))
	if second.Get("type").String() != "error" || second.Get("error.code").String() != "user_session_required" || u.calls() != 1 {
		t.Fatalf("signed-out turn was not refused: %s; upstream calls=%d", second.Raw, u.calls())
	}
	if _, response, err := dialSock(t, ts, "/responses", nil); err == nil || response == nil || response.StatusCode != 401 {
		t.Fatalf("signed-out handshake: response=%v err=%v", response, err)
	}
}
