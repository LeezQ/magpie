package stallionx

import (
	"encoding/json"
	"strings"
	"testing"
)

// The server's personal list contains full secrets; rendering masked text in
// JavaScript is insufficient. Assert the bytes sent to the webview are safe.
func TestAccountRecordsExcludeSecretsAndInternalCosts(t *testing.T) {
	for _, tt := range []struct{ action, raw, want string }{
		{"keys", `{"items":[{"id":"token_public","name":"Desktop","key":"sk-fixture-secret-1234","quota":"0","used_amount":"0.000001","status":1,"private":"hidden"}],"total":1}`, `"masked_key":"••••1234"`},
		{"keys", `{"items":[{"key":"tiny"}],"total":1}`, `"masked_key":"••••"`},
		{"logs", `{"items":[{"request_id":"req_fixture","cost":"0.000001","cache_creation_1h_tokens":12,"usage_known":false,"user_id":"hidden","username":"hidden","channel_id":"hidden","channel_name":"hidden","channel_group_id":"hidden","channel_cost":"hidden","gross_profit":"hidden","gross_margin":"hidden","agent_id":"hidden","agent_cost":"hidden"}],"total":1}`, `"cost":"0.000001"`},
	} {
		t.Run(tt.action+tt.want, func(t *testing.T) {
			out, err := publicAccountRecords(tt.action, json.RawMessage(tt.raw))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(out), tt.want) {
				t.Fatalf("missing public field: %s", out)
			}
			for _, secret := range []string{"sk-fixture", "tiny", `"key":`, "hidden", "user_id", "username", "channel_id", "channel_name", "channel_group_id", "channel_cost", "gross_profit", "gross_margin", "agent_id", "agent_cost"} {
				if strings.Contains(string(out), secret) {
					t.Fatalf("private field %q escaped: %s", secret, out)
				}
			}
		})
	}
}

// Scope identity comes from the upstream response. An omitted or null identity
// must not be normalized to the empty string used by its personal-scope UI.
func TestLogRecordsPreserveScopeIdentity(t *testing.T) {
	for _, tt := range []struct {
		name, item, teamID, teamName string
	}{
		{"omitted", `{}`, "", ""},
		{"null", `{"team_id":null,"team_name":null}`, "null", "null"},
		{"personal", `{"team_id":"","team_name":""}`, `""`, `""`},
		{"named team", `{"team_id":"team_public","team_name":"Workspace"}`, `"team_public"`, `"Workspace"`},
		{"unnamed team", `{"team_id":"team_public","team_name":""}`, `"team_public"`, `""`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			out, err := publicAccountRecords("logs", json.RawMessage(`{"items":[`+tt.item+`],"total":1}`))
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				Items []map[string]json.RawMessage `json:"items"`
				Total int                          `json:"total"`
			}
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatal(err)
			}
			if len(got.Items) != 1 || got.Total != 1 {
				t.Fatalf("unexpected pagination: %s", out)
			}
			for field, want := range map[string]string{"team_id": tt.teamID, "team_name": tt.teamName} {
				value, exists := got.Items[0][field]
				if exists != (want != "") || string(value) != want {
					t.Errorf("%s = %s (present %t), want %s", field, value, exists, want)
				}
			}
		})
	}
}

// Malformed lists are failures, never a successful empty page that conceals an
// outage. No response fragment or secret is copied into the error message.
func TestAccountRecordsRejectIncompleteLists(t *testing.T) {
	for _, raw := range []string{`{`, `{}`, `{"items":null,"total":0}`, `{"items":[],"total":-1}`, `{"items":[{"key":123}],"total":1}`} {
		if _, err := publicAccountRecords("keys", json.RawMessage(raw)); err == nil {
			t.Errorf("accepted incomplete list %s", raw)
		}
	}
}
