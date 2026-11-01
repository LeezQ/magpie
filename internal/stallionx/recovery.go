package stallionx

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"github.com/yetone/magpie/internal/provider"
)

func customProvider(p provider.Provider, s saved) bool {
	return p.Preset != ProviderID || len(p.Keys) != 0 || s.KeyHash == "" || keyHash(p.Key) != s.KeyHash
}

func setupConflict(s saved) bool {
	ps, err := provider.Stored()
	if err != nil {
		return false
	}
	for _, p := range ps {
		if p.ID == ProviderID {
			return customProvider(p, s)
		}
	}
	return false
}

// RepairAccount is an explicitly confirmed recovery, never part of sign-in.
// It preserves conflicting credentials and settings under a new disabled
// provider, then provisions the application's own model access independently.
func RepairAccount(ctx context.Context) UserStatus {
	setupMu.Lock()
	defer setupMu.Unlock()
	s, err := readAccount()
	if err != nil {
		return User(ctx)
	}
	out := User(ctx)
	if out.State != "authenticated" {
		return out
	}
	mu.Lock()
	now, err := readAccount()
	if err == nil && (now.At != s.At || now.Email != s.Email || now.Service != s.Service) {
		err = errors.New("the account changed; refresh before restoring automatic setup")
	}
	if err == nil {
		err = preserveConflict(now)
	}
	invalidateAccess()
	mu.Unlock()
	if err != nil {
		out = User(ctx)
		out.Setup = "failed"
		out.SetupMessage = err.Error()
		return out
	}
	return syncAccount(ctx)
}

func preserveConflict(s saved) error {
	ps, err := provider.Stored()
	if err != nil {
		return err
	}
	ids := make(map[string]bool, len(ps))
	var conflict *provider.Provider
	for i := range ps {
		ids[ps[i].ID] = true
		if ps[i].ID == ProviderID && customProvider(ps[i], s) {
			conflict = &ps[i]
		}
	}
	if conflict == nil {
		return nil
	}
	to := ProviderID + "-preserved"
	for n := 2; ids[to]; n++ {
		to = fmt.Sprintf("%s-preserved-%d", ProviderID, n)
	}
	// Stop on either write failure. A failed rename leaves the original
	// saved, switched off, and still identifiable for an explicit retry.
	if err := provider.SetOff(ProviderID, true); err != nil {
		return err
	}
	if err := provider.Rename(ProviderID, to); err != nil {
		return err
	}
	ps, err = provider.Stored()
	if err != nil {
		return err
	}
	preserved := false
	for _, p := range ps {
		if p.ID == ProviderID {
			return errors.New("provider configuration changed during recovery; no managed credentials were saved")
		}
		if p.ID == to {
			preserved = p.Off && p.Key == conflict.Key && reflect.DeepEqual(p.Keys, conflict.Keys) && reflect.DeepEqual(p.Models, conflict.Models) && reflect.DeepEqual(p.Headers, conflict.Headers)
		}
	}
	if !preserved {
		return errors.New("the previous provider could not be verified after preservation")
	}
	return nil
}
