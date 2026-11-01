package gui

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/settings"
)

func TestStallionDefaultTextSizeBoot(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	s := settings.Load()
	if s.TextSize != 125 || zoomOf(s.TextSize) != 1.25 {
		t.Fatalf("new desktop opens at %d%%, want 125%%", s.TextSize)
	}
	// Expose only the native host interface, not the fixture's browser marker.
	w := struct{ Windows }{&zoomWindows{}}
	h := Handler(w, nil)
	boot := func() string {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", "/boot.js", nil))
		if r.Code != 200 {
			t.Fatalf("boot status %d", r.Code)
		}
		return r.Body.String()
	}
	if got := boot(); !strings.Contains(got, `"textSize":125`) || !strings.Contains(got, `"web":false`) {
		t.Fatalf("first-paint bootstrap does not match native default: %s", got)
	}
	s.TextSize = 100
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if got := boot(); !strings.Contains(got, `"textSize":100`) {
		t.Fatalf("explicit smaller setting was not preserved: %s", got)
	}
}
