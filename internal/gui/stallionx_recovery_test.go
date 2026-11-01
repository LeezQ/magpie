package gui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStallionRepairRequiresConfirmationAndAccount(t *testing.T) {
	builtinHome(t)
	mux := http.NewServeMux()
	stallionxRoutes(mux)
	for _, body := range []string{`{}`, `{"confirm":false}`, `broken`} {
		r := httptest.NewRecorder()
		mux.ServeHTTP(r, httptest.NewRequest("POST", "/api/stallionx/repair", strings.NewReader(body)))
		if r.Code == 200 {
			t.Fatalf("repair accepted absent confirmation: %s", body)
		}
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, httptest.NewRequest("POST", "/api/stallionx/repair", strings.NewReader(`{"confirm":true}`)))
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"state":"signed_out"`) || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unsigned repair: %d %s", r.Code, r.Body)
	}
}
