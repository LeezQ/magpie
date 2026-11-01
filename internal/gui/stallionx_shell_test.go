package gui

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// The presentation policy must arrive in boot.js, not after /api/state: a
// dedicated client must not flash the plugin marketplace on its first paint.
// Reading boot leaves the runtime's plugin switches exactly as they were.
func TestStallionXShellBoot(t *testing.T) {
	h := builtinHome(t)
	before, err := json.Marshal(builtinsState())
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/boot.js", nil))
	if r.Code != 200 {
		t.Fatalf("boot: %d %s", r.Code, r.Body)
	}
	body := strings.TrimSuffix(strings.TrimPrefix(r.Body.String(), "window.bootPrefs = "), ";\n")
	var boot map[string]any
	if err := json.Unmarshal([]byte(body), &boot); err != nil {
		t.Fatal(err)
	}
	if boot["stallionxEnabled"] != true {
		t.Fatal("dedicated visibility missing before first paint")
	}
	after, err := json.Marshal(builtinsState())
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("frontend visibility changed backend plugin state")
	}
}
