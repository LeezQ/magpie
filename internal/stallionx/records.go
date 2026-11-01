package stallionx

import (
	"encoding/json"
	"errors"
	"log"
)

// publicAccountRecords is the customer-facing boundary for personal lists.
// Stallion's key list includes plaintext credentials and its log rows include
// internal margin/cost fields. Forward only fields used by this read-only UI,
// retaining raw decimal strings/nulls instead of rounding money through float64.
func publicAccountRecords(action string, raw json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Items []map[string]json.RawMessage `json:"items"`
		Total *int                         `json:"total"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		log.Printf("stallionx: decoding %s list: %v", action, err)
		return nil, err
	}
	if in.Items == nil || in.Total == nil || *in.Total < 0 {
		log.Printf("stallionx: incomplete %s list", action)
		return nil, errors.New("StallionX returned an incomplete account list")
	}
	// team_id is Stallion's public team identity, not its storage foreign key.
	fields := []string{"id", "model", "request_id", "request_path", "created_at", "status", "error_message", "token_name", "token_id", "team_id", "team_name", "request_time", "is_stream", "first_byte_time", "prompt_tokens", "completion_tokens", "cache_read_tokens", "cache_creation_tokens", "cache_creation_1h_tokens", "usage_known", "cost", "group_discount_rate", "billing_type", "input_price", "output_price", "cache_read_price", "cache_creation_price", "cache_creation_1h_price", "call_price", "client_ip", "user_agent"}
	if action == "keys" {
		fields = []string{"id", "name", "quota", "used_amount", "period_type", "period_quota", "period_used_amount", "period_start_at", "models", "allowed_ips", "expires_at", "status", "last_used_at", "created_at"}
	}
	items := make([]map[string]json.RawMessage, 0, len(in.Items))
	for _, item := range in.Items {
		out := make(map[string]json.RawMessage, len(fields)+1)
		for _, field := range fields {
			if v, ok := item[field]; ok {
				out[field] = v
			}
		}
		if action == "keys" {
			var key string
			if err := json.Unmarshal(item["key"], &key); err != nil {
				log.Printf("stallionx: decoding account key field: %v", err)
				return nil, errors.New("StallionX returned an invalid account key")
			}
			// No full key, prefix, title attribute or clipboard data reaches the
			// client. Short values are fully hidden rather than accidentally shown.
			masked := "••••"
			if len(key) > 8 {
				masked += key[len(key)-4:]
			}
			out["masked_key"], _ = json.Marshal(masked)
		}
		items = append(items, out)
	}
	out, err := json.Marshal(struct {
		Items []map[string]json.RawMessage `json:"items"`
		Total int                          `json:"total"`
	}{items, *in.Total})
	if err != nil {
		log.Printf("stallionx: encoding public %s list: %v", action, err)
	}
	return out, err
}
