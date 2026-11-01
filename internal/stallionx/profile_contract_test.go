package stallionx

import (
	"encoding/json"
	"testing"
)

// Stallion's userToSafeMap serializes BillingMode as an integer enum, including
// zero for an own wallet. Keep both values numeric through the webview boundary;
// omitting zero would make a real billing mode indistinguishable from no field.
func TestUserProfileBillingModeContract(t *testing.T) {
	for _, mode := range []string{"0", "1"} {
		t.Run(mode, func(t *testing.T) {
			raw := json.RawMessage(`{"id":42,"username":"alice","email":"alice@example.com","email_verified":true,"balance":"12.500001","used_amount":"1.20","group_name":"Standard","billing_mode":` + mode + `,"created_at":"2026-11-01T00:00:00Z","status":1,"active_tokens":2}`)
			profile, err := decodeProfile(raw)
			if err != nil {
				t.Fatalf("numeric billing_mode prevents loading user profile: %v", err)
			}
			if profile.ID != "42" || profile.Balance != "12.500001" || profile.ActiveTokens != 2 || !profile.EmailVerified {
				t.Fatalf("neighboring profile fields changed: %+v", profile)
			}
			encoded, err := json.Marshal(profile)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &fields); err != nil {
				t.Fatal(err)
			}
			if got := string(fields["billingMode"]); got != mode {
				t.Fatalf("billingMode = %s, want numeric %s", got, mode)
			}
		})
	}
}
