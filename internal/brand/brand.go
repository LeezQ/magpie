// Package brand holds the identity this build ships under: StallionX, a
// fork of magpie (MIT, © yetone). Everything that must differ from an
// upstream magpie installed on the same machine reads it from here: the
// folders it keeps its data in, the port its gateway listens on, the macOS
// bundle id and launch agent labels, the URL scheme and the name of its
// command line. Go module paths and internal identifiers stay magpie's so
// upstream changes keep merging.
package brand

import "strings"

const (
	// Name is the product name people see: window titles, the tray, the
	// About line, notifications.
	Name = "StallionX"

	// Slug names everything on disk and on the command line: the data
	// folder (~/.config/stallionx), cache and log folders, the CLI
	// (`stallionx`), the URL scheme (stallionx://).
	Slug = "stallionx"

	// BundleID is the macOS bundle identifier; the tray's login item is
	// launched under it too.
	BundleID = "com.stallionx.client"

	// ServeLabel is the launch agent that runs `stallionx serve`.
	ServeLabel = BundleID + ".serve"

	// Scheme is the URL scheme provider links use: stallionx://import?…
	Scheme = Slug

	// DefaultPort is the gateway's port when Settings names none. It is
	// not magpie's 3425, so both can run on one machine.
	DefaultPort = 3435

	// ServiceURL is the StallionX service the built-in provider signs in
	// to and sends requests through.
	ServiceURL = "https://x.stallion-api.run"

	// Copyright is the line the About panel and the Windows resources carry.
	Copyright = "© 2026 StallionX · MIT · based on magpie © yetone"
)

// commandWords follow "magpie" where it names the command line, so it is
// written as the command (stallionx serve) rather than the product name.
// Only words that after "magpie" are a command and never prose ("the magpie
// app", "a magpie backup" are prose) are listed.
var commandWords = map[string]bool{
	"web": true, "serve": true, "daemon": true, "quota": true, "accounts": true,
	"command": true, "import": true, "presets": true, "doctor": true,
	"uninstall": true, "login": true, "logout": true, "version": true, "help": true,
}

// Text puts StallionX's name where magpie's is a word of a sentence meant
// for people. Inside an identifier (magpie_x, magpie-dev), a path
// (/magpie/, magpie.app, .magpie), a link (magpie://, usemagpie.ai) it is
// left alone. Followed by one of its commands ("magpie web", "magpie daemon
// install") it is the command line, written stallionx.
func Text(s string) string {
	if !strings.Contains(s, "agpie") {
		return s
	}
	var b strings.Builder
	i := 0
	for {
		j := nextName(s, i)
		if j < 0 {
			b.WriteString(s[i:])
			return b.String()
		}
		end := j + len("magpie")
		b.WriteString(s[i:j])
		switch {
		case !isWord(s, j, end):
			b.WriteString(s[j:end])
		case s[j] == 'm' && isCommand(s[end:]):
			b.WriteString(Slug)
		default:
			b.WriteString(Name)
		}
		i = end
	}
}

// nextName is where "magpie" or "Magpie" next starts at or after i, or -1.
func nextName(s string, i int) int {
	for k := i; k+6 <= len(s); k++ {
		if (s[k] == 'm' || s[k] == 'M') && s[k+1:k+6] == "agpie" {
			return k
		}
	}
	return -1
}

// isWord says whether the name at s[j:end] stands as a word of prose.
//
// Before it, a letter, digit or one of _ . / : @ - \ $ { makes it part of
// something else (an identifier, path, host, variable or a {magpie} slot);
// after it, a letter, digit or one of _ / : @ - \ } does.
func isWord(s string, j, end int) bool {
	if j > 0 && strings.IndexByte("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./:@-\\${", s[j-1]) >= 0 {
		return false
	}
	if end >= len(s) {
		return true
	}
	if strings.IndexByte("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/:@-\\}", s[end]) >= 0 {
		return false
	}
	// "magpie.app", "magpie.exe": a file; "in magpie." ends a sentence
	if s[end] == '.' && end+1 < len(s) && isLetter(s[end+1]) {
		return false
	}
	return true
}

func isLetter(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }

// isCommand says whether rest, what follows the name, starts with one of
// its commands: " web", " daemon install".
func isCommand(rest string) bool {
	if !strings.HasPrefix(rest, " ") {
		return false
	}
	w := rest[1:]
	k := 0
	for k < len(w) && w[k] >= 'a' && w[k] <= 'z' {
		k++
	}
	return commandWords[w[:k]]
}
