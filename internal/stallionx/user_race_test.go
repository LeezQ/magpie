package stallionx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func TestDelayedUserReadRevalidatesReplacementLogin(t *testing.T) {
	for _, email := range []string{"alice@example.com", "bob@example.com"} {
		for _, oldStatus := range []int{200, 401} {
			t.Run(fmt.Sprintf("%s/%d", email, oldStatus), func(t *testing.T) {
				if _, err := SignOut(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _, _ = SignOut() })
				fake := &fakeService{codes: map[string]string{"alice@example.com": "123456", "bob@example.com": "123456"}}
				auth := fake.handler(t)
				reached, release := make(chan struct{}), make(chan struct{})
				unblock := sync.OnceFunc(func() { close(release) })
				var holdNext atomic.Bool
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/api/user/self" && holdNext.CompareAndSwap(true, false) {
						close(reached)
						<-release
						if oldStatus != 200 {
							w.WriteHeader(oldStatus)
							json.NewEncoder(w).Encode(envelope{Message: "old session rejected"})
							return
						}
					}
					auth.ServeHTTP(w, r)
				}))
				t.Cleanup(server.Close)
				t.Setenv("STALLIONX_URL", server.URL)
				ctx := context.Background()
				if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
					t.Fatal(err)
				}
				holdNext.Store(true)
				finished := make(chan struct{})
				var result UserStatus
				go func() { defer close(finished); result = User(ctx) }()
				t.Cleanup(func() { unblock(); <-finished })
				<-reached
				if _, err := SignIn(ctx, email, "123456", "", "en"); err != nil {
					t.Fatal(err)
				}
				unblock()
				<-finished
				if result.State != "authenticated" || result.Setup != "ready" || result.Email != email || result.Profile == nil || result.Profile.Email != email {
					t.Fatalf("late response misreported replacement login: %+v", result)
				}
			})
		}
	}
}
