package update

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Missing package metadata must not direct users to upgrade upstream.
func TestForkPackageCommand(t *testing.T) {
	for manager, want := range map[string]string{
		"homebrew": "brew upgrade stallionx",
		"pacman":   "yay -S stallionx",
		"dpkg":     "sudo apt install --only-upgrade stallionx",
		"rpm":      "sudo dnf upgrade stallionx",
	} {
		if got := (&Packaged{Manager: manager}).Command(); got != want {
			t.Errorf("%s command = %q, want %q", manager, got, want)
		}
	}
}

// Writing and settling a fork shim must preserve a neighboring upstream
// command. Run on every OS because shim ownership is platform-independent.
func TestForkShimLeavesUpstream(t *testing.T) {
	dir := t.TempDir()
	upstream := filepath.Join(dir, "magpie.cmd")
	write(t, upstream, "upstream command")
	exe := filepath.Join(dir, "stallionx-windows-amd64.exe")
	p, err := writeShim(exe)
	if err != nil || p != filepath.Join(dir, "stallionx.cmd") {
		t.Fatalf("fork shim = %q, %v", p, err)
	}
	clearBeside(exe)
	if got := read(t, upstream); got != "upstream command" {
		t.Fatalf("upstream command changed: %q", got)
	}
	if exists(p) {
		t.Fatal("fork shim not removed after settling")
	}
}

// #942: the site's Windows download is magpie-windows-amd64.exe, and Add
// to PATH put its folder on PATH, where a terminal finds no `magpie`. Add
// writes a stallionx.cmd beside a program not named magpie.exe that runs it by
// its folder and name, which an update keeps, and the Command line reads
// that stallionx.cmd as this app; one written for another program isn't.
func TestCLIShim(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "magpie-windows-amd64.exe")
	if err := os.WriteFile(exe, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	p, err := writeShim(exe)
	if err != nil {
		t.Fatal(err)
	}
	if p != filepath.Join(dir, "stallionx.cmd") {
		t.Fatalf("shim at %q", p)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "\"%~dp0magpie-windows-amd64.exe\" %*\r\n") || !strings.HasPrefix(string(b), "@echo off\r\n") {
		t.Fatalf("stallionx.cmd:\n%q", b)
	}
	if !shimRuns(p, exe) {
		t.Fatal("the stallionx.cmd written isn't read as running this app")
	}
	if shimRuns(p, filepath.Join(dir, "magpie-old.exe")) {
		t.Fatal("stallionx.cmd read as running another program")
	}
	// renamed, as a second download is: written again for the new name
	exe2 := filepath.Join(dir, "magpie-windows-amd64 (1).exe")
	if _, err := writeShim(exe2); err != nil {
		t.Fatal(err)
	}
	if !shimRuns(p, exe2) || shimRuns(p, exe) {
		t.Fatal("stallionx.cmd not written again for the renamed program")
	}

	// magpie.exe is found by its own name: nothing written
	dir2 := t.TempDir()
	if p, err := writeShim(filepath.Join(dir2, "StallionX.exe")); err != nil || p != "" {
		t.Fatalf("magpie.exe given a shim: %q, %v", p, err)
	}
	if _, err := os.Stat(filepath.Join(dir2, "stallionx.cmd")); !os.IsNotExist(err) {
		t.Fatal("stallionx.cmd written beside magpie.exe")
	}
}
