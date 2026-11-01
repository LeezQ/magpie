//go:build ignore

// sandbox launches a development command with a persistent, separate HOME.
// Port separation alone is insufficient: agent-specific environment variables
// can still point at real credentials. Use the same authoritative list as tests.
// Build tools keep their original caches; the application gets no real home.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/yetone/magpie/internal/agentenv"
	"github.com/yetone/magpie/internal/proc"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "sandbox needs a command")
		os.Exit(2)
	}
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Resolve Portless before isolating HOME: its route registry belongs to
	// the developer, not the sandbox. Never silently fall back to production
	// when the local resolver fails. An explicit endpoint remains authoritative.
	if strings.TrimSpace(os.Getenv("STALLIONX_URL")) == "" {
		resolver := filepath.Join(cwd, "..", "main", "scripts", "portless-url.sh")
		lookup := proc.Command("bash", resolver, "stallion-x-api")
		lookup.Stderr = os.Stderr
		out, err := lookup.Output()
		if err != nil || strings.TrimSpace(string(out)) == "" {
			fmt.Fprintf(os.Stderr, "resolve local StallionX backend: %v; start ../main/scripts/restart.sh backend or set STALLIONX_URL explicitly\n", err)
			os.Exit(1)
		}
		os.Setenv("STALLIONX_URL", strings.TrimSpace(string(out)))
	}
	fmt.Fprintf(os.Stderr, "StallionX development backend: %s\n", os.Getenv("STALLIONX_URL"))
	home := filepath.Join(cwd, ".stallionx-dev-home")
	if err := os.MkdirAll(home, 0700); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Clear inherited agent homes and upstream control variables before assigning
	// local-only development addresses. Nothing imports installed subscriptions.
	for _, key := range agentenv.Vars {
		os.Unsetenv(key)
	}
	for _, key := range []string{"MAGPIE_PUBLIC_URL", "MAGPIE_REPLACES", "MAGPIE_GATEWAY", "MAGPIE_WEB_URL", "APPIMAGE", "APPDIR"} {
		os.Unsetenv(key)
	}
	for key, value := range map[string]string{
		"HOME": home, "USERPROFILE": home,
		"XDG_CONFIG_HOME": filepath.Join(home, ".config"), "XDG_CACHE_HOME": filepath.Join(home, ".cache"),
		"XDG_DATA_HOME": filepath.Join(home, ".local", "share"), "XDG_STATE_HOME": filepath.Join(home, ".local", "state"),
		"APPDATA": filepath.Join(home, "AppData", "Roaming"), "LOCALAPPDATA": filepath.Join(home, "AppData", "Local"),
		"MAGPIE_NO_ACCOUNTS": "1", "MAGPIE_NO_INSTALL": "1", "MAGPIE_NO_STATS": "1", "MAGPIE_PARTNERS": "off",
		"MAGPIE_ADDR": "127.0.0.1:3426", "MAGPIE_DEV_UI": "127.0.0.1:3427",
		"MAGPIE_DEV_BACKEND": "127.0.0.1:3428", "MAGPIE_DEV_CONTROL": "127.0.0.1:3429",
	} {
		os.Setenv(key, value)
	}
	fmt.Fprintf(os.Stderr, "StallionX development: HOME=%s (%s), gateway 3426, UI 3427\n", home, runtime.GOOS)
	cmd := proc.Command(os.Args[1], os.Args[2:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "development process:", err)
		os.Exit(1)
	}
}
