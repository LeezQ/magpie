//go:build dev

package gui

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/stallionx"
)

// The browser dev listener must serve the same boundary as the desktop shell;
// guarding only Handler's return value leaves MAGPIE_DEV_UI's raw mux open.
func TestStallionRequiredUserGuardsDevListener(t *testing.T) {
	const child = "MAGPIE_TEST_STALLION_DEV_REQUIRED"
	if os.Getenv(child) != "1" {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := proc.Command(exe, "-test.run=^TestStallionRequiredUserGuardsDevListener$")
		cmd.Env = append(os.Environ(), child+"=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("required-user dev listener: %v\n%s", err, out)
		}
		return
	}
	stallionx.EnableRequiredUser()
	t.Setenv("MAGPIE_DEV_UI", "127.0.0.1:0")
	builtinHome(t)
	if devUI == nil || devUI.Addr == "" {
		t.Fatal("development UI did not start")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := devUI.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	})
	transport := &http.Transport{Proxy: nil}
	t.Cleanup(transport.CloseIdleConnections)
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	for _, tt := range []struct {
		method, path string
		status       int
		framed       bool
	}{
		{"GET", "/api/state", 401, false},
		{"GET", "/api/providers", 401, false},
		{"POST", "/api/settings", 401, false},
		{"POST", "/api/dev/import", 401, false},
		{"GET", pluginPagePrefix + "token/index.html", 401, false},
		{"GET", "/", 200, false},
		{"GET", "/api/stallionx/user", 200, false},
		{"GET", "/api/dev/wait", 200, false},
		{"GET", "/api/stallionx/user", 403, true},
	} {
		req, err := http.NewRequest(tt.method, "http://"+devUI.Addr+tt.path, strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		if tt.framed {
			req.Header.Set("Sec-Fetch-Dest", "iframe")
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != tt.status {
			t.Fatalf("dev %s %s: %d %s", tt.method, tt.path, res.StatusCode, body)
		}
		if tt.status == 401 && !strings.Contains(string(body), `"code":"user_session_required"`) {
			t.Fatalf("development listener bypassed account guard: %s", body)
		}
	}
}
