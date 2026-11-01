package gui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/yetone/magpie/internal/stallionx"
)

func stallionxWalletRoutes(mux *http.ServeMux) {
	for _, action := range []string{"balance", "config", "orders", "logs", "keys", "create", "redeem"} {
		method := "GET"
		if action == "create" || action == "redeem" {
			method = "POST"
		}
		mux.HandleFunc(method+" /api/stallionx/wallet/"+action, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()
			var in struct {
				Value  string `json:"value"`
				Locale string `json:"locale"`
			}
			if method == "POST" {
				if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
					fail(w, err)
					return
				}
			}
			var data any
			var err error
			data, err = stallionx.Wallet(ctx, action, r.URL.Query(), in.Value)
			if errors.Is(err, stallionx.ErrWalletSession) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				writeJSON(w, map[string]string{"error": err.Error(), "code": "user_session_required"})
				return
			}
			if err != nil {
				fail(w, err)
				return
			}
			writeJSON(w, data)
		})
	}
}
