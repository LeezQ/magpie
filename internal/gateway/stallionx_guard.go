package gateway

import (
	"context"
	"net/http"
	"strings"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/stallionx"
)

func stallionxRequired(next http.Handler) http.Handler {
	guarded := stallionxAccountGuard(next, stallionx.Access)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !stallionx.UserRequired() {
			next.ServeHTTP(w, r)
			return
		}
		guarded.ServeHTTP(w, r)
	})
}

// Put the boundary inside socketEntry: every WebSocket turn, not just its
// handshake, must stop after sign-out. The remaining host/key guards still run.
func stallionxAccountGuard(next http.Handler, account func(context.Context) stallionx.UserStatus) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stallionxGatewayBootstrap(r) {
			next.ServeHTTP(w, r)
			return
		}
		user := account(r.Context())
		if user.State == "authenticated" && user.Setup == "ready" && user.ProviderConnected {
			next.ServeHTTP(w, r)
			return
		}
		code, status, message := "user_session_required", http.StatusUnauthorized, "Sign in to StallionX to use its gateway"
		if user.State == "unavailable" {
			code, status, message = "user_service_unavailable", http.StatusServiceUnavailable, "StallionX account verification is temporarily unavailable"
		} else if user.State == "authenticated" {
			code, status, message = "user_setup_required", http.StatusConflict, "Finish syncing your StallionX account before using its gateway"
		}
		proto := provider.Chat
		if strings.HasPrefix(r.URL.Path, "/messages") || strings.HasPrefix(r.URL.Path, "/v1/messages") {
			proto = provider.Anthropic
		}
		w.Header().Set("Cache-Control", "no-store")
		writeErrorSaid(w, proto, status, message, code, nil)
	})
}

func stallionxGatewayBootstrap(r *http.Request) bool {
	// Process discovery and local diagnostics must remain usable to open or
	// repair the login UI. Their existing Host/Origin/loopback checks remain.
	if r.Method == http.MethodGet {
		switch r.URL.Path {
		case "/", "/v1", "/v1/", "/api/hello", "/api/version", GoroutinesPath, HeapPath, CPUPath:
			return true
		}
	}
	return r.Method == http.MethodPost && r.URL.Path == RestartPath
}
