package gui

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/stallionx"
)

const consoleAPIPrefix = "/api/stallionx/console"

var accountConsole struct {
	sync.Mutex
	binding, origin, capability string
	server                      *http.Server
}

// The Web account console has its own origin: it cannot read the desktop DOM,
// call the native window API, or access its storage. Only a session-bound local
// capability crosses the parent/frame bridge, never a Stallion credential.
func stallionxConsoleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/stallionx/console-session", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		binding, err := stallionx.ConsoleBinding(ctx)
		if err != nil {
			if errors.Is(err, stallionx.ErrWalletSession) {
				w.WriteHeader(http.StatusUnauthorized)
				writeJSON(w, map[string]string{"error": "Sign in to StallionX to open your account", "code": "user_session_required"})
			} else {
				w.WriteHeader(http.StatusServiceUnavailable)
				writeJSON(w, map[string]string{"error": err.Error(), "code": "user_service_unavailable"})
			}
			return
		}
		files, err := fs.Sub(staticFS(), "stallionx-console")
		if err == nil {
			_, err = fs.Stat(files, "index.html")
		}
		if err != nil {
			fail(w, err)
			return
		}
		accountConsole.Lock()
		defer accountConsole.Unlock()
		if accountConsole.binding != binding || accountConsole.server == nil {
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				fail(w, err)
				return
			}
			var secret [32]byte
			if _, err := rand.Read(secret[:]); err != nil {
				listener.Close()
				fail(w, err)
				return
			}
			origin, capability := "http://"+listener.Addr().String(), hex.EncodeToString(secret[:])
			proxy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { stallionx.ConsoleServe(w, r, binding) })
			server := &http.Server{Handler: consoleHandler(origin, capability, files, proxy), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 16 << 10}
			if accountConsole.server != nil {
				accountConsole.server.Close()
			}
			accountConsole.binding, accountConsole.origin, accountConsole.capability = binding, origin, capability
			accountConsole.server = server
			go func() {
				if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
					log.Printf("StallionX account console: %v", err)
				}
			}()
		}
		writeJSON(w, map[string]any{"url": accountConsole.origin + "/", "capability": accountConsole.capability})
	})
}

func consoleHandler(origin, capability string, files fs.FS, proxy http.Handler) http.Handler {
	u, _ := url.Parse(origin)
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
		deny := func(status int) { http.Error(w, "Account console request refused", status) }
		if u == nil || r.Host != u.Host || r.URL.User != nil {
			deny(http.StatusForbidden)
			return
		}
		p, escaped := r.URL.Path, strings.ToLower(r.URL.EscapedPath())
		clean := path.Clean(p)
		if strings.HasSuffix(p, "/") && clean != "/" {
			clean += "/"
		}
		if p != clean || strings.ContainsAny(p, "\\\x00") || strings.Contains(escaped, "%2f") || strings.Contains(escaped, "%2e") || strings.Contains(escaped, "%5c") || strings.Contains(escaped, "%00") {
			deny(http.StatusBadRequest)
			return
		}
		if strings.HasPrefix(p, consoleAPIPrefix+"/api/") {
			headers := r.Header.Values("Authorization")
			if len(headers) != 1 || subtle.ConstantTimeCompare([]byte(headers[0]), []byte("Bearer "+capability)) != 1 {
				deny(http.StatusUnauthorized)
				return
			}
			from := r.Header.Get("Origin")
			if (from != "" && from != origin) || (r.Method != http.MethodGet && r.Method != http.MethodHead && from != origin) || r.Method == http.MethodOptions {
				deny(http.StatusForbidden)
				return
			}
			forward := r.Clone(r.Context())
			forward.URL.Path = strings.TrimPrefix(p, consoleAPIPrefix)
			forward.URL.RawPath = ""
			forward.Header.Del("Authorization")
			forward.Header.Del("Cookie")
			proxy.ServeHTTP(w, forward)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			deny(http.StatusMethodNotAllowed)
			return
		}
		if strings.HasPrefix(p, "/api/") {
			deny(http.StatusNotFound)
			return
		}
		name := strings.TrimPrefix(p, "/")
		if name == "" {
			name = "index.html"
		}
		info, err := fs.Stat(files, name)
		if err != nil || info.IsDir() {
			deny(http.StatusNotFound)
			return
		}
		// FileServer redirects /index.html. Serve the document through / so the
		// dedicated frame gets bytes directly and never needs an SPA fallback.
		if p == "/index.html" {
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		static.ServeHTTP(w, r)
	})
}
