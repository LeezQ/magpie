package gui

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/yetone/magpie/internal/stallionx"
)

// stallionxRoutes serves the one account session and automatic model-service
// setup. The old /api/stallionx response remains provider metadata only;
// every account UI and authorization guard uses User/Access instead.
//
//	GET  /api/stallionx          the account: stallionx.Status
//	POST /api/stallionx/code     {email, locale} → {testCode?}
//	GET  /api/stallionx/user     → UserStatus
//	POST /api/stallionx/signin   {email, code, invite?, locale} → UserStatus
//	POST /api/stallionx/signout  → UserStatus
//	POST /api/stallionx/sync     → UserStatus
//	POST /api/stallionx/repair   {confirm:true} → UserStatus
func stallionxRoutes(mux *http.ServeMux) {
	stallionxWalletRoutes(mux)
	stallionxConsoleRoutes(mux)
	mux.HandleFunc("GET /api/stallionx/user", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		writeJSON(w, stallionx.User(ctx))
	})
	mux.HandleFunc("POST /api/stallionx/sync", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		writeJSON(w, stallionx.SyncAccount(ctx))
	})
	mux.HandleFunc("POST /api/stallionx/repair", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var in struct {
			Confirm bool `json:"confirm"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
			fail(w, err)
			return
		}
		if !in.Confirm {
			fail(w, errors.New("confirm preserving the previous provider before restoring automatic setup"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		writeJSON(w, stallionx.RepairAccount(ctx))
	})
	mux.HandleFunc("GET /api/stallionx", func(rw http.ResponseWriter, r *http.Request) {
		writeJSON(rw, stallionx.Current())
	})
	mux.HandleFunc("POST /api/stallionx/code", func(rw http.ResponseWriter, r *http.Request) {
		var in struct {
			Email  string `json:"email"`
			Locale string `json:"locale"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(rw, r.Body, 16<<10)).Decode(&in); err != nil {
			log.Printf("stallionx: the code request's body: %v", err)
			fail(rw, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		sent, err := stallionx.SendCode(ctx, in.Email, serviceLocale(in.Locale))
		if err != nil {
			// SendCode logged what the service said; the page shows it
			fail(rw, err)
			return
		}
		writeJSON(rw, sent)
	})
	mux.HandleFunc("POST /api/stallionx/signin", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-store")
		var in struct {
			Email  string `json:"email"`
			Code   string `json:"code"`
			Invite string `json:"invite"`
			Locale string `json:"locale"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(rw, r.Body, 16<<10)).Decode(&in); err != nil {
			log.Printf("stallionx: the sign-in's body: %v", err)
			fail(rw, err)
			return
		}
		// the login, the key and the first read of the model list
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		st, err := stallionx.SignIn(ctx, in.Email, in.Code, in.Invite, serviceLocale(in.Locale))
		if err != nil {
			fail(rw, err)
			return
		}
		user := stallionx.User(ctx)
		user.IsNew = st.IsNew
		writeJSON(rw, user)
	})
	mux.HandleFunc("POST /api/stallionx/signout", func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-store")
		_, err := stallionx.SignOut()
		if err != nil {
			fail(rw, err)
			return
		}
		writeJSON(rw, stallionx.User(r.Context()))
	})
}

// serviceLocale is the page's language as the service names the two it
// writes mail in: Chinese of either script is "zh-CN", anything else "en".
func serviceLocale(lang string) string {
	if len(lang) >= 2 && lang[:2] == "zh" {
		return "zh-CN"
	}
	return "en"
}
