package gui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStallionWalletRoutesRequireAccountSession(t *testing.T) {
	h := builtinHome(t)
	for _, op := range []string{"balance", "config", "orders", "logs", "keys", "create", "redeem"} {
		method := "GET"
		if op == "create" || op == "redeem" {
			method = "POST"
		}
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(method, "/api/stallionx/wallet/"+op, strings.NewReader(`{"value":"test"}`)))
		if r.Code != 401 || !strings.Contains(r.Body.String(), `"code":"user_session_required"`) {
			t.Fatalf("%s: %d %s", op, r.Code, r.Body.String())
		}
		if r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("wallet data may be cached")
		}
	}
	for _, path := range []string{"/stallionx-wallet.js", "/stallionx-wallet.css", "/stallionx-wallet-i18n.js"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 200 || r.Body.Len() == 0 {
			t.Fatalf("asset %s: %d", path, r.Code)
		}
	}
}

func TestStallionUserRoutesHaveOneSignedOutState(t *testing.T) {
	builtinHome(t)
	mux := http.NewServeMux()
	stallionxRoutes(mux)
	for _, route := range []struct{ method, path string }{{"GET", "/api/stallionx/user"}, {"POST", "/api/stallionx/sync"}, {"POST", "/api/stallionx/signout"}} {
		r := httptest.NewRecorder()
		mux.ServeHTTP(r, httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`)))
		var out map[string]any
		if err := json.Unmarshal(r.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if r.Code != 200 || out["state"] != "signed_out" || out["providerConnected"] != false {
			t.Fatalf("%s: %d %s", route.path, r.Code, r.Body)
		}
		if r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("user state may be cached")
		}
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, httptest.NewRequest("POST", "/api/stallionx/wallet/verify", strings.NewReader(`{}`)))
	if r.Code != 404 {
		t.Fatal("separate wallet login still registered")
	}
}
