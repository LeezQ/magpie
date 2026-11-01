package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestWalletUsesAccountSessionAndPersonalEndpoints(t *testing.T) {
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = SignOut() })
	f := &fakeService{codes: map[string]string{}}
	auth := f.handler(t)
	var lock sync.Mutex
	var paths []string
	var mutations []map[string]string
	unauthorized := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/user/verification" || r.URL.Path == "/api/user/email-login" || r.URL.Path == "/api/cli/provision" {
			auth.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v1/") || r.URL.Path == "/models" {
			w.WriteHeader(404)
			return
		}
		lock.Lock()
		defer lock.Unlock()
		paths = append(paths, r.Method+" "+r.URL.RequestURI())
		if r.Header.Get("Authorization") != "Bearer jwt-for-alice@example.com" {
			t.Error("wallet did not use the account JWT")
		}
		if unauthorized {
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(envelope{Message: "expired"})
			return
		}
		var data any
		switch r.URL.Path {
		case "/api/user/self":
			data = map[string]any{"balance": "18.123456", "email": "private@example.com", "role": 999}
		case "/api/payment/config":
			data = map[string]any{"enabled": false}
		case "/api/payment/orders", "/api/log/self", "/api/token/":
			if r.URL.Path == "/api/token/" && r.URL.Query().Get("workspace") != "personal" {
				t.Error("key list did not select the personal workspace")
			}
			if r.Method == "GET" {
				if r.URL.Query().Has("user_id") || r.URL.Query().Has("token_id") {
					t.Error("identity filter escaped")
				}
				data = map[string]any{"items": []any{}, "total": 0, "page": 2, "page_size": 20}
				if r.URL.Path == "/api/token/" {
					data = map[string]any{"items": []any{map[string]any{"id": "token_fixture", "key": "sk-private-fixture-1234", "name": "Desktop"}}, "total": 1}
				}
			} else {
				var b map[string]string
				json.NewDecoder(r.Body).Decode(&b)
				mutations = append(mutations, b)
				data = map[string]any{"order": map[string]string{"public_id": "ord_test", "status": "pending"}}
			}
		case "/api/user/topup":
			var b map[string]string
			json.NewDecoder(r.Body).Decode(&b)
			mutations = append(mutations, b)
			data = map[string]string{"balance": "25.00"}
		default:
			t.Errorf("unexpected wallet path %s", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("STALLIONX_URL", srv.URL)
	ctx := context.Background()
	if _, err := SendCode(ctx, "alice@example.com", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	paths = nil
	lock.Unlock()
	q := url.Values{"page": {"2"}, "page_size": {"20"}, "user_id": {"user_someone"}, "token_id": {"other"}}
	for _, action := range []string{"balance", "config", "orders", "logs", "keys", "create", "redeem"} {
		out, err := Wallet(ctx, action, q, " 12.50 ")
		if err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		if action == "keys" && (strings.Contains(string(out), "sk-private") || !strings.Contains(string(out), `"masked_key":"••••1234"`)) {
			t.Fatalf("key list crossed the account boundary without redaction: %s", out)
		}
		if action == "balance" && string(out) != `{"balance":"18.123456"}` {
			t.Fatalf("balance should be exact and redacted: %s", out)
		}
	}
	lock.Lock()
	if len(paths) != 7 || len(mutations) != 2 || mutations[0]["amount"] != "12.50" || mutations[1]["code"] != "12.50" {
		t.Errorf("operations: %v %v", paths, mutations)
	}
	unauthorized = true
	lock.Unlock()
	if _, err := Wallet(ctx, "redeem", nil, "code"); !errors.Is(err, ErrWalletSession) {
		t.Fatalf("expired session: %v", err)
	}
	lock.Lock()
	if len(paths) != 8 {
		t.Error("financial operation retried")
	}
	unauthorized = false
	lock.Unlock()
	forgetWallet()
	if _, err := Wallet(ctx, "balance", nil, ""); err != nil {
		t.Fatalf("restart lost saved session: %v", err)
	}
	p, _ := provider.Find(ProviderID)
	before := p.Key
	if err := VerifyWallet(ctx, "123456", "en"); err != nil {
		t.Fatal(err)
	}
	p, _ = provider.Find(ProviderID)
	if p.Key != before {
		t.Fatal("verification replaced model key")
	}
	if _, err := Wallet(ctx, "balance", nil, ""); err != nil {
		t.Fatal(err)
	}
	p.Key = "manually-replaced"
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	if _, err := Wallet(ctx, "balance", nil, ""); err != nil {
		t.Fatal("model key change incorrectly logged out the user", err)
	}
	p.Key = before
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	if _, err := SignOut(); err != nil {
		t.Fatal(err)
	}
	if _, err := Wallet(ctx, "balance", nil, ""); !errors.Is(err, ErrWalletSession) {
		t.Fatal("signed out wallet still accessible")
	}
}

func TestWalletRejectsUnknownOperations(t *testing.T) {
	f := &fakeService{}
	serve(t, f)
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := Wallet(ctx, "../admin/orders", nil, ""); err == nil {
		t.Fatal("arbitrary path accepted")
	}
}
