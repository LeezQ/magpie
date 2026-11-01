package gui

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
)

const (
	consoleTestOrigin = "http://127.0.0.1:48763"
	consoleTestCap    = "console-fixture-capability-not-an-upstream-credential"
	consoleTestAPI    = "/api/stallionx/console/api/"
)

func consoleTestHandler(proxy http.Handler) http.Handler {
	return consoleHandler(consoleTestOrigin, consoleTestCap, fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>Console fixture</title><div id=console-root></div>")},
		"assets/app.js": {Data: []byte("window.consoleFixture = true;")},
	}, proxy)
}

func consoleTestRequest(method, path string) *http.Request {
	r := httptest.NewRequest(method, consoleTestOrigin+path, nil)
	r.Header.Set("Authorization", "Bearer "+consoleTestCap)
	if method != http.MethodGet && method != http.MethodHead {
		r.Header.Set("Origin", consoleTestOrigin)
	}
	return r
}

func consoleTestDenied(t *testing.T, h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code < 400 || w.Code >= 500 {
		t.Fatalf("%s %s was not refused: %d %s", r.Method, r.URL, w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), consoleTestCap) || strings.Contains(w.Header().Get("Location"), consoleTestCap) {
		t.Fatal("refusal disclosed the console capability")
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "" || w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("isolated console enabled CORS: %v", w.Header())
	}
	return w
}

func TestStallionConsoleStaticRequiresNoAccountCapability(t *testing.T) {
	h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("static request reached the account proxy")
	}))
	for _, path := range []string{"/", "/index.html", "/assets/app.js"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			r := consoleTestRequest(method, path)
			r.Header.Del("Authorization")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusOK {
				t.Fatalf("static %s %s: %d %s", method, path, w.Code, w.Body.String())
			}
			if method == http.MethodHead && w.Body.Len() != 0 {
				t.Fatalf("static HEAD returned a body: %s", path)
			}
			if method == http.MethodGet && w.Body.Len() == 0 {
				t.Fatalf("static GET is empty: %s", path)
			}
			csp := w.Header().Get("Content-Security-Policy")
			found := false
			for _, directive := range strings.Split(csp, ";") {
				fields := strings.Fields(directive)
				if len(fields) > 0 && fields[0] == "connect-src" {
					found = len(fields) == 2 && fields[1] == "'self'"
				}
			}
			if !found {
				t.Fatalf("console connections are not limited to its own origin: %q", csp)
			}
			if w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("static console document permits cross-origin reads")
			}
		}
	}
	for _, path := range []string{"/missing.js", "/personal/dashboard", "/api/user/self", "/api/stallionx/console", "/api/stallionx/console/apix/user/self"} {
		consoleTestDenied(t, h, consoleTestRequest(http.MethodGet, path))
	}
	consoleTestDenied(t, h, consoleTestRequest(http.MethodPost, "/index.html"))
}

func TestStallionConsolePinsExactLoopbackHost(t *testing.T) {
	h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("request with the wrong Host reached the account proxy")
	}))
	for _, host := range []string{
		"", "127.0.0.1", "127.0.0.1:48764", "localhost:48763", "127.0.0.1.attacker.test:48763",
		"attacker.test:48763", "[::1]:48763", "127.0.0.1:48763@attacker.test", "127.0.0.1:48763.",
	} {
		for _, path := range []string{"/", consoleTestAPI + "user/self"} {
			t.Run(host+path, func(t *testing.T) {
				r := consoleTestRequest(http.MethodGet, path)
				r.Host = host
				consoleTestDenied(t, h, r)
			})
		}
	}
}

func TestStallionConsoleCapabilityIsBearerOnly(t *testing.T) {
	h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("request without one valid bearer capability reached the account proxy")
	}))
	for _, tc := range []struct {
		name string
		edit func(*http.Request)
	}{
		{"missing", func(r *http.Request) { r.Header.Del("Authorization") }},
		{"wrong", func(r *http.Request) { r.Header.Set("Authorization", "Bearer another-capability") }},
		{"prefix", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+consoleTestCap+"x") }},
		{"basic", func(r *http.Request) { r.SetBasicAuth("console", consoleTestCap) }},
		{"duplicate", func(r *http.Request) { r.Header.Add("Authorization", "Bearer another-capability") }},
		{"query", func(r *http.Request) {
			r.Header.Del("Authorization")
			r.URL.RawQuery = "capability=" + url.QueryEscape(consoleTestCap)
		}},
		{"cookie", func(r *http.Request) {
			r.Header.Del("Authorization")
			r.AddCookie(&http.Cookie{Name: "capability", Value: consoleTestCap})
		}},
		{"userinfo", func(r *http.Request) {
			r.Header.Del("Authorization")
			r.URL.User = url.UserPassword("console", consoleTestCap)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := consoleTestRequest(http.MethodGet, consoleTestAPI+"user/self")
			tc.edit(r)
			consoleTestDenied(t, h, r)
		})
	}
}

func TestStallionConsoleChecksOriginOnEveryMutation(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		for _, origin := range []string{"", "null", "https://attacker.test", "http://localhost:48763", "http://127.0.0.1:48764", consoleTestOrigin + "/", consoleTestOrigin + " https://attacker.test"} {
			t.Run(method+" "+origin, func(t *testing.T) {
				h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
					t.Fatal("cross-origin mutation reached the account proxy")
				}))
				r := consoleTestRequest(method, consoleTestAPI+"token/")
				r.Header.Set("Origin", origin)
				consoleTestDenied(t, h, r)
			})
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		t.Run(method+" foreign origin", func(t *testing.T) {
			h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("cross-origin request reached the account proxy")
			}))
			r := consoleTestRequest(method, consoleTestAPI+"user/self")
			r.Header.Set("Origin", "https://attacker.test")
			r.Header.Set("Access-Control-Request-Method", "POST")
			r.Header.Set("Access-Control-Request-Headers", "authorization")
			consoleTestDenied(t, h, r)
		})
	}
}

func TestStallionConsoleForwardsOnlyOriginalAPIWithoutBrowserCredentials(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			calls := 0
			h := consoleTestHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/api/token/" || r.URL.RawQuery != "workspace=personal&page=2" {
					t.Errorf("proxy received a different upstream operation: %s", r.URL)
				}
				if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.URL.User != nil {
					t.Errorf("browser credentials reached the upstream bridge: %v", r.Header)
				}
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != `{"name":"fixture"}` {
					t.Errorf("request body changed: %q, %v", body, err)
				}
				if r.Method != method || r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("request method/content type changed: %s %v", r.Method, r.Header)
				}
				w.WriteHeader(http.StatusAccepted)
			}))
			r := consoleTestRequest(method, consoleTestAPI+"token/?workspace=personal&page=2")
			r.Body = io.NopCloser(strings.NewReader(`{"name":"fixture"}`))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(&http.Cookie{Name: "upstream_session", Value: "must-not-forward"})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusAccepted || calls != 1 {
				t.Fatalf("valid request did not reach exactly one proxy operation: %d calls=%d %s", w.Code, calls, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("account API is cacheable: %v", w.Header())
			}
			if r.Header.Get("Authorization") != "Bearer "+consoleTestCap || r.Header.Get("Cookie") == "" {
				t.Fatal("proxy sanitization mutated the caller's request headers")
			}
		})
	}
}

func TestStallionConsoleRejectsAmbiguousPaths(t *testing.T) {
	h := consoleTestHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("ambiguous route reached the account proxy")
	}))
	for _, path := range []string{
		"/../index.html", "/assets/../index.html", "//index.html", "/assets//app.js",
		"/%2e%2e/index.html", "/assets%2fapp.js", "/assets/%5capp.js", "/index.html%00",
		consoleTestAPI + "../user/self", consoleTestAPI + "%2e%2e/user/self", consoleTestAPI + "user%2fself",
		consoleTestAPI + "user%5cself", consoleTestAPI + "user\\self", consoleTestAPI + "user//self",
	} {
		t.Run(path, func(t *testing.T) {
			consoleTestDenied(t, h, consoleTestRequest(http.MethodGet, path))
		})
	}
}

func TestStallionConsoleSessionRequiresAuthenticatedAccount(t *testing.T) {
	builtinHome(t)
	mux := http.NewServeMux()
	stallionxRoutes(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/stallionx/console-session", strings.NewReader(`{}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("signed-out account obtained a console session: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "capability") || strings.Contains(w.Body.String(), "127.0.0.1:") {
		t.Fatalf("signed-out response disclosed a console destination: %s", w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("console-session response may be cached")
	}
}
