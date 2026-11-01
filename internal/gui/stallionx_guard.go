package gui

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/yetone/magpie/internal/stallionx"
)

// The executable enables the commercial boundary at startup. The GUI package
// remains reusable by the upstream shell's tests and embedded consumers.
func stallionxRequired(next http.Handler) http.Handler {
	guarded := stallionxWorkspaceGuard(next, stallionx.Access)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !stallionx.UserRequired() {
			next.ServeHTTP(w, r)
			return
		}
		guarded.ServeHTTP(w, r)
	})
}

func stallionxWorkspaceGuard(next http.Handler, account func(context.Context) stallionx.UserStatus) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspace := strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, pluginPagePrefix)
		if !workspace || stallionxBeforeLogin(r) {
			next.ServeHTTP(w, r)
			return
		}
		user := account(r.Context())
		if user.State == "authenticated" && user.Setup == "ready" && user.ProviderConnected {
			next.ServeHTTP(w, r)
			return
		}
		// Stripe checkout must also work while model setup needs credit.
		if user.State == "authenticated" && stallionxCheckout(r) {
			next.ServeHTTP(w, r)
			return
		}
		code, status, message := "user_session_required", http.StatusUnauthorized, "Sign in to StallionX to use this feature"
		if user.State == "unavailable" {
			code, status, message = "user_service_unavailable", http.StatusServiceUnavailable, "StallionX account verification is temporarily unavailable"
		} else if user.State == "authenticated" {
			code, status, message = "user_setup_required", http.StatusConflict, "Finish syncing your StallionX account before using the workspace"
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		writeJSON(w, map[string]string{"code": code, "error": message, "state": user.State})
	})
}

// Only bootstrap and recovery routes are public here; wallet routes perform
// their own account check and remain available while model setup needs credit.
func stallionxBeforeLogin(r *http.Request) bool {
	path := r.URL.Path
	if r.Method == http.MethodGet {
		switch path {
		case "/api/stallionx", "/api/stallionx/user", "/api/fonts", "/api/omarchy", "/api/dev/wait",
			"/api/stallionx/wallet/balance", "/api/stallionx/wallet/config", "/api/stallionx/wallet/orders", "/api/stallionx/wallet/logs", "/api/stallionx/wallet/keys":
			return true
		}
	}
	if r.Method == http.MethodPost {
		switch path {
		case "/api/stallionx/code", "/api/stallionx/signin", "/api/stallionx/signout", "/api/stallionx/sync", "/api/stallionx/repair",
			"/api/stallionx/console-session",
			"/api/stallionx/wallet/create", "/api/stallionx/wallet/redeem",
			"/api/window/hide", "/api/window/main", "/api/window/quit", "/api/window/fit", "/api/window/tint", "/api/window/titlebar":
			return true
		case "/api/open":
			// Terms/privacy must open from the login page. Do not expose the
			// upstream launcher's custom app schemes or arbitrary local URLs.
			u := stallionxOpenURL(r)
			return u == stallionx.Base()+"/terms" || u == stallionx.Base()+"/privacy"
		}
	}
	return false
}

func stallionxCheckout(r *http.Request) bool {
	if r.Method != http.MethodPost || r.URL.Path != "/api/open" {
		return false
	}
	u, err := url.Parse(stallionxOpenURL(r))
	return err == nil && u.Scheme == "https" && u.Host == "checkout.stripe.com" && u.User == nil
}

func stallionxOpenURL(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (16<<10)+1))
	// Preserve even an oversized body for an authenticated caller.
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(body), r.Body), r.Body}
	if err != nil || len(body) > 16<<10 {
		return ""
	}
	var in struct{ URL string }
	if json.Unmarshal(body, &in) != nil {
		return ""
	}
	return in.URL
}
