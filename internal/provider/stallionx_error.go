package provider

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Agents display gateway errors themselves and do not load the desktop's
// translations. Keep the upstream diagnostic for their error classifiers,
// with Chinese recovery first for the dedicated client's users.
func (p Provider) stallionXError(msg string, status int, body []byte) string {
	if p.Preset != StallionXPreset || status != 403 && status != 402 {
		return msg
	}
	var hint string
	switch APIError(body, "") {
	case "Insufficient balance":
		hint = "余额不足，请在 StallionX 用户中心充值后重试。"
	case "Insufficient team balance":
		hint = "团队余额不足，请联系团队所有者为团队钱包充值后重试。"
	}
	if hint == "" || strings.HasPrefix(msg, hint) {
		return msg
	}
	return hint + " (" + msg + ")"
}

// StallionXRefusal corrects the service's 403 balance refusal before gateway
// routing and protocol translation. External agents treat 403 as a bad API key;
// a wallet that needs funding is 402, never an authentication or rate-limit fault.
func StallionXRefusal(p Provider, res *http.Response) *http.Response {
	if p.Preset != StallionXPreset || res == nil || res.Body == nil || res.StatusCode != http.StatusForbidden || res.ContentLength > 64<<10 {
		return res
	}
	ct := strings.ToLower(res.Header.Get("Content-Type"))
	if res.Header.Get("Content-Encoding") != "" || !strings.Contains(ct, "json") {
		return res
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, (64<<10)+1))
	res.Body = &stallionXErrorBody{prefix: bytes.NewReader(b), original: res.Body, err: err}
	if err != nil || len(b) > 64<<10 {
		return res
	}
	var envelope struct {
		Success *bool `json:"success"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(b, &envelope) != nil || envelope.Error == nil && (envelope.Success == nil || *envelope.Success) {
		return res
	}
	message := APIError(b, "")
	code := "stallionx_insufficient_balance"
	switch message {
	case "Insufficient balance":
	case "Insufficient team balance":
		code = "stallionx_insufficient_team_balance"
	default:
		return res
	}
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	detail, _ := raw["error"].(map[string]any)
	if detail == nil {
		detail = map[string]any{"message": message}
	}
	detail["type"] = "billing_error"
	detail["code"] = code
	next, _ := json.Marshal(map[string]any{"error": detail})
	res.Body.Close()
	res.Body = io.NopCloser(bytes.NewReader(next))
	res.StatusCode = http.StatusPaymentRequired
	res.Status = "402 Payment Required"
	res.ContentLength = int64(len(next))
	res.Header.Set("Content-Length", strconv.Itoa(len(next)))
	return res
}

// Inspection must replay every byte and any read error for unrelated replies.
type stallionXErrorBody struct {
	prefix   *bytes.Reader
	original io.ReadCloser
	err      error
}

func (b *stallionXErrorBody) Read(p []byte) (int, error) {
	if b.prefix.Len() > 0 {
		return b.prefix.Read(p)
	}
	if b.err != nil {
		return 0, b.err
	}
	return b.original.Read(p)
}

func (b *stallionXErrorBody) Close() error { return b.original.Close() }

// StallionXBillingDisplay supplies the localized title WorkBuddy's custom-model
// adapter carries from error.displayMsg into its error banner. Its default 402
// title means "login expired", so a corrected HTTP status alone is insufficient.
// Only our namespaced codes opt in; upstream display metadata is never trusted.
func StallionXBillingDisplay(code any) map[string]string {
	switch code {
	case "stallionx_insufficient_balance":
		return map[string]string{
			"zh-cn": "余额不足，请在 StallionX 用户中心充值后重试。",
			"zh-tw": "餘額不足，請在 StallionX 使用者中心儲值後重試。",
			"en":    "Insufficient balance. Top up in the StallionX user center, then try again.",
		}
	case "stallionx_insufficient_team_balance":
		return map[string]string{
			"zh-cn": "团队余额不足，请联系团队所有者为团队钱包充值后重试。",
			"zh-tw": "團隊餘額不足，請聯絡團隊擁有者為團隊錢包儲值後重試。",
			"en":    "Insufficient team balance. Ask the team owner to fund the team wallet, then try again.",
		}
	}
	return nil
}
