package stallionx

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestRepairAccountPreservesConflictingProviderAndRebuildsManagedAccess(t *testing.T) {
	serve(t, &fakeService{})
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	p, err := provider.Find(ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	p.Key = "custom-primary"
	p.Keys = []provider.KeyAccount{{Name: "second", Key: "custom-second"}}
	p.Models = []string{"custom-model"}
	p.Headers = map[string]string{"X-Custom": "custom-value"}
	if err := provider.Save(*p); err != nil {
		t.Fatal(err)
	}
	existing := provider.Provider{ID: ProviderID + "-preserved", Name: "Existing preserved", Chat: "https://example.invalid/v1", Key: "unrelated-key", Off: true}
	if err := provider.Save(existing); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, id := range []string{ProviderID + "-preserved", ProviderID + "-preserved-2"} {
			_ = provider.Delete(id)
		}
	})
	if st := User(ctx); !st.SetupConflict || st.Setup != "failed" || st.State != "authenticated" {
		t.Fatalf("conflict not recoverable: %+v", st)
	}
	st := RepairAccount(ctx)
	if st.State != "authenticated" || st.Setup != "ready" || st.SetupConflict || !st.ProviderConnected {
		t.Fatalf("repair failed: %+v", st)
	}
	kept, err := provider.Find(ProviderID + "-preserved-2")
	if err != nil || !kept.Off || kept.Key != p.Key || !reflect.DeepEqual(kept.Keys, p.Keys) || !reflect.DeepEqual(kept.Models, p.Models) || !reflect.DeepEqual(kept.Headers, p.Headers) {
		t.Fatalf("custom provider changed: %+v, %v", kept, err)
	}
	untouched, err := provider.Find(existing.ID)
	if err != nil || untouched.Key != existing.Key {
		t.Fatal("existing preservation target was overwritten")
	}
	managed, err := provider.Find(ProviderID)
	if err != nil || managed.Key != "sk-stallionx-test" || len(managed.Keys) != 0 || managed.Off {
		t.Fatalf("managed setup retained custom credentials: %+v, %v", managed, err)
	}
	if st := RepairAccount(ctx); st.Setup != "ready" || st.SetupConflict {
		t.Fatalf("repeat repair: %+v", st)
	}
	if _, err := provider.Find(ProviderID + "-preserved-3"); err == nil {
		t.Fatal("repeat repair needlessly preserved managed provider")
	}
}

func TestRepairAccountCannotChangeProvidersWithoutVerifiedSession(t *testing.T) {
	serve(t, &fakeService{})
	p := provider.Provider{ID: ProviderID, Name: "Manual", Chat: "https://example.invalid/v1", Key: "custom-key"}
	if err := provider.Save(p); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = provider.Delete(ProviderID) })
	before, err := os.ReadFile(provider.Path())
	if err != nil {
		t.Fatal(err)
	}
	if st := RepairAccount(context.Background()); st.State != "signed_out" {
		t.Fatal(st)
	}
	after, err := os.ReadFile(provider.Path())
	if err != nil || string(before) != string(after) {
		t.Fatal("unsigned recovery mutated provider configuration")
	}
}

func TestRepairAccountRefusesUnreadableProviderStore(t *testing.T) {
	serve(t, &fakeService{})
	ctx := context.Background()
	SendCode(ctx, "alice@example.com", "en")
	if _, err := SignIn(ctx, "alice@example.com", "123456", "", "en"); err != nil {
		t.Fatal(err)
	}
	backup := provider.Path() + ".repair-test"
	if err := os.Rename(provider.Path(), backup); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(provider.Path()); _ = os.Rename(backup, provider.Path()) })
	if err := os.Mkdir(provider.Path(), 0700); err != nil {
		t.Fatal(err)
	}
	st := RepairAccount(ctx)
	if st.State != "authenticated" || st.Setup != "failed" || st.SetupMessage == "" {
		t.Fatalf("unreadable store was not failed closed: %+v", st)
	}
	if info, err := os.Stat(provider.Path()); err != nil || !info.IsDir() {
		t.Fatal("repair replaced unreadable configuration")
	}
}
