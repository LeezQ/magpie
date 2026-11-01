package provider

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStallionXBalanceRefusalExplainsRecovery(t *testing.T) {
	for _, tc := range []struct {
		name, preset, body, want string
		status                   int
	}{
		{"personal", StallionXPreset, `{"success":false,"message":"Insufficient balance"}`, "余额不足，请在 StallionX 用户中心充值后重试。", 403},
		{"team", StallionXPreset, `{"success":false,"message":"Insufficient team balance"}`, "团队余额不足，请联系团队所有者为团队钱包充值后重试。", 403},
		{"openai", StallionXPreset, `{"error":{"message":"Insufficient balance","code":"insufficient_balance"}}`, "余额不足，请在 StallionX 用户中心充值后重试。", 403},
		{"other provider", "other", `{"success":false,"message":"Insufficient balance"}`, "", 403},
		{"disabled account", StallionXPreset, `{"success":false,"message":"Account is disabled"}`, "", 403},
		{"key quota", StallionXPreset, `{"success":false,"message":"This API key's quota is exhausted"}`, "", 403},
		{"member quota", StallionXPreset, `{"success":false,"message":"Your quota in this team is exhausted"}`, "", 403},
		{"different status", StallionXPreset, `{"success":false,"message":"Insufficient balance"}`, "", 500},
		{"unrelated mention", StallionXPreset, `{"error":{"message":"Cannot parse response: Insufficient balance"}}`, "", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := Provider{ID: "renamed-provider", Name: "StallionX", Preset: tc.preset}
			original := p.Name + ": " + APIError([]byte(tc.body), "Forbidden")
			got := p.Explain(original, tc.status, []byte(tc.body))
			if tc.want == "" {
				if got != original {
					t.Fatalf("unrelated error changed: %q, want %q", got, original)
				}
				return
			}
			if !strings.HasPrefix(got, tc.want) || !strings.Contains(got, original) {
				t.Fatalf("refusal lacks Chinese recovery or original diagnostic: %q", got)
			}
			if again := p.Explain(got, tc.status, []byte(tc.body)); again != got {
				t.Fatalf("repeated explanation duplicates the hint: %q", again)
			}
		})
	}
}

func TestStallionXBalanceRefusalInModelProbe(t *testing.T) {
	for _, message := range []string{"Insufficient balance", "Insufficient team balance"} {
		t.Run(message, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				fmt.Fprintf(w, `{"success":false,"message":%q}`, message)
			}))
			t.Cleanup(up.Close)
			p := Provider{ID: "stallionx", Preset: StallionXPreset, Key: "fixture-key", Chat: up.URL + "/v1"}
			r := probe(context.Background(), p, Chat, up.URL+"/v1/chat/completions", []byte(`{"model":"m","messages":[]}`), "m", time.Second)
			if r.OK || r.Status != 402 || !strings.Contains(r.Error, "余额不足") || !strings.Contains(r.Error, message) {
				t.Fatalf("model probe lost recovery or refusal details: %+v", r)
			}
		})
	}
}

func TestStallionXRefusalOnlyChangesEmptyWallets(t *testing.T) {
	for _, tc := range []struct {
		name, preset, body, contentType, encoding string
		status, want                              int
	}{
		{"personal", StallionXPreset, `{"success":false,"message":"Insufficient balance"}`, "application/json", "", 403, 402},
		{"team", StallionXPreset, `{"success":false,"message":"Insufficient team balance"}`, "application/json", "", 403, 402},
		{"openai", StallionXPreset, `{"error":{"message":"Insufficient balance","code":"insufficient_balance","param":"wallet"}}`, "application/json", "", 403, 402},
		{"different provider", "other", `{"success":false,"message":"Insufficient balance"}`, "application/json", "", 403, 403},
		{"authentication", StallionXPreset, `{"success":false,"message":"Invalid API key"}`, "application/json", "", 401, 401},
		{"permission", StallionXPreset, `{"success":false,"message":"Account is disabled"}`, "application/json", "", 403, 403},
		{"quota", StallionXPreset, `{"success":false,"message":"This API key's quota is exhausted"}`, "application/json", "", 403, 403},
		{"successful", StallionXPreset, `{"success":true,"message":"Insufficient balance"}`, "application/json", "", 200, 200},
		{"not a refusal", StallionXPreset, `{"success":true,"message":"Insufficient balance"}`, "application/json", "", 403, 403},
		{"not json", StallionXPreset, `Insufficient balance`, "text/plain", "", 403, 403},
		{"compressed", StallionXPreset, `{"success":false,"message":"Insufficient balance"}`, "application/json", "gzip", 403, 403},
		{"malformed", StallionXPreset, `{"success":false,`, "application/json", "", 403, 403},
		{"large", StallionXPreset, strings.Repeat(" ", 64<<10) + `{"success":false,"message":"Insufficient balance"}`, "application/json", "", 403, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": {tc.contentType}}, Body: io.NopCloser(strings.NewReader(tc.body))}
			if tc.encoding != "" {
				res.Header.Set("Content-Encoding", tc.encoding)
			}
			got := StallionXRefusal(Provider{Preset: tc.preset}, res)
			defer got.Body.Close()
			b, err := io.ReadAll(got.Body)
			if err != nil || got.StatusCode != tc.want {
				t.Fatalf("status %d, want %d; read error: %v", got.StatusCode, tc.want, err)
			}
			if tc.want == tc.status && string(b) != tc.body {
				t.Fatalf("unrelated body changed: %q", b)
			}
			if tc.want == 402 && (!strings.Contains(string(b), `"type":"billing_error"`) || !strings.Contains(string(b), `"code":"stallionx_insufficient_`) || int64(len(b)) != got.ContentLength) {
				t.Fatalf("missing billing classification or invalid content length: %s", b)
			}
			if tc.name == "openai" && !strings.Contains(string(b), `"param":"wallet"`) {
				t.Fatalf("upstream error metadata lost: %s", b)
			}
		})
	}
}

type stallionXFailedRead struct {
	closed bool
	err    error
}

func (r *stallionXFailedRead) Read([]byte) (int, error) { return 0, r.err }
func (r *stallionXFailedRead) Close() error             { r.closed = true; return nil }

func TestStallionXRefusalPreservesReadFailure(t *testing.T) {
	broken := &stallionXFailedRead{err: errors.New("fixture read failure")}
	res := &http.Response{StatusCode: 403, Header: http.Header{"Content-Type": {"application/json"}}, Body: broken}
	res = StallionXRefusal(Provider{Preset: StallionXPreset}, res)
	_, err := io.ReadAll(res.Body)
	res.Body.Close()
	if !errors.Is(err, broken.err) || !broken.closed || res.StatusCode != 403 {
		t.Fatalf("read failure swallowed or original body leaked: err=%v closed=%v status=%d", err, broken.closed, res.StatusCode)
	}
}
