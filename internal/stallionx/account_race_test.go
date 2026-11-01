package stallionx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestDelayedSignInCannotUndoLaterAccountAction(t *testing.T) {
	for _, action := range []string{"signout", "newer login"} {
		t.Run(action, func(t *testing.T) {
			if _, err := SignOut(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _, _ = SignOut() })
			fake := &fakeService{codes: map[string]string{"alice@example.com": "123456", "bob@example.com": "123456"}}
			auth := fake.handler(t)
			reached, release := make(chan struct{}), make(chan struct{})
			unblock := sync.OnceFunc(func() { close(release) })
			var first sync.Once
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/user/email-login" {
					delay := false
					first.Do(func() { delay = true })
					if delay {
						close(reached)
						<-release
					}
				}
				auth.ServeHTTP(w, r)
			}))
			t.Cleanup(server.Close)
			t.Setenv("STALLIONX_URL", server.URL)
			finished := make(chan struct{})
			var loginErr error
			go func() {
				defer close(finished)
				_, loginErr = SignIn(context.Background(), "alice@example.com", "123456", "", "en")
			}()
			t.Cleanup(func() { unblock(); <-finished })
			<-reached
			if action == "signout" {
				if _, err := SignOut(); err != nil {
					t.Fatal(err)
				}
			} else if _, err := SignIn(context.Background(), "bob@example.com", "123456", "", "en"); err != nil {
				t.Fatal(err)
			}
			unblock()
			<-finished
			if loginErr == nil {
				t.Fatal("delayed sign-in reported success after a later account action")
			}
			if action == "signout" {
				if st := User(context.Background()); st.State != "signed_out" {
					t.Fatalf("delayed sign-in revived account: %+v", st)
				}
				for _, path := range []string{accountFile(), walletFile()} {
					if _, err := os.Stat(path); !os.IsNotExist(err) {
						t.Fatalf("delayed sign-in recreated %s: %v", path, err)
					}
				}
				if _, err := provider.Find(ProviderID); err == nil {
					t.Fatal("delayed sign-in recreated provider")
				}
			} else if st := User(context.Background()); st.State != "authenticated" || st.Email != "bob@example.com" {
				t.Fatalf("delayed sign-in replaced newer account: %+v", st)
			}
		})
	}
}
