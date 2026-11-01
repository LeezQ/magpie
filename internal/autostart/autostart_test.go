package autostart

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Startup writes and removal must coexist with upstream's login record.
// Windows' registry value is checked separately without accessing the hive.
func TestForkAutostartLeavesUpstream(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the Run key is the real user's")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	want, old := "stallionx.desktop", "magpie.desktop"
	if runtime.GOOS == "darwin" {
		want, old = "com.stallionx.client.plist", "com.yetone.magpie.plist"
	} else if runtime.GOOS == "android" {
		want, old = "stallionx", "magpie"
	}
	if filepath.Base(record()) != want {
		t.Fatalf("fork startup record is %q, want %q", record(), want)
	}
	upstream := filepath.Join(filepath.Dir(record()), old)
	if err := os.MkdirAll(filepath.Dir(upstream), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(upstream, []byte("upstream login"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := enable("/opt/stallionx"); err != nil {
		t.Fatal(err)
	}
	if err := disable(); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(upstream); err != nil || string(b) != "upstream login" {
		t.Fatalf("upstream login changed: %q, %v", b, err)
	}
}

// On, the system's record names this program and the tray; off, it's gone,
// and turning it off again is no error.
func TestSet(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the Run key is the real user's")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", home+"/.config")
	t.Setenv("APPIMAGE", "/opt/my apps/magpie.AppImage")
	if Enabled() != Off {
		t.Fatal("on before it was turned on")
	}
	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	if Enabled() == Off {
		t.Fatal("not on after Set(true)")
	}
	path := record()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	arg := Arg
	if runtime.GOOS == "android" {
		arg = "serve"
	}
	for _, want := range []string{"/opt/my apps/magpie.AppImage", arg} {
		if !strings.Contains(string(b), want) {
			t.Errorf("%s lacks %q:\n%s", path, want, b)
		}
	}
	if err := Set(false); err != nil || Enabled() != Off {
		t.Fatalf("still on after Set(false): %v", err)
	}
	if err := Set(false); err != nil {
		t.Fatal(err)
	}
}
