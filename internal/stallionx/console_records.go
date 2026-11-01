package stallionx

import (
	"encoding/json"
	"strings"
)

func markConsoleManagedKey(raw json.RawMessage, hash string) (json.RawMessage, error) {
	var list map[string]json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, err
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(list["items"], &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		if hash != "" && keyHash(rawString(item["key"])) == hash {
			item["desktop_managed"] = json.RawMessage("true")
		}
	}
	var err error
	list["items"], err = json.Marshal(items)
	if err != nil {
		return nil, err
	}
	return json.Marshal(list)
}

func keepConsoleFields(in map[string]json.RawMessage, fields string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, field := range strings.Fields(fields) {
		if v, ok := in[field]; ok {
			out[field] = v
		}
	}
	return out
}

func consolePublicData(path string, raw json.RawMessage) (json.RawMessage, error) {
	if strings.HasPrefix(path, "/api/task/") || strings.Contains(path, "/tasks/") {
		var task map[string]json.RawMessage
		if err := json.Unmarshal(raw, &task); err != nil {
			return nil, err
		}
		return json.Marshal(keepConsoleFields(task, "task_id team_id user_id model status platform action type pre_charge actual_cost group_discount_rate error_message created_at updated_at settled_at"))
	}
	if path == "/api/user/self" {
		var user map[string]json.RawMessage
		if err := json.Unmarshal(raw, &user); err != nil {
			return nil, err
		}
		return json.Marshal(keepConsoleFields(user, "id username email email_verified role status balance used_amount billing_mode created_at updated_at group_id group_name group_rate request_count active_tokens locale branding has_password"))
	}
	isKeys := path == "/api/token/" || strings.HasSuffix(path, "/tokens")
	isLogs := path == "/api/log/self" || strings.HasSuffix(path, "/logs") && strings.HasPrefix(path, "/api/team/")
	isGroups := path == "/api/channel-group/"
	if isKeys || isLogs || isGroups {
		var list map[string]json.RawMessage
		if err := json.Unmarshal(raw, &list); err != nil {
			return nil, err
		}
		var items []map[string]json.RawMessage
		if err := json.Unmarshal(list["items"], &items); err != nil {
			return nil, err
		}
		for i, item := range items {
			switch {
			case isKeys:
				items[i] = keepConsoleFields(item, "id user_id team_id name channel_group_id channel_group_ids quota used_amount period_type period_quota period_used_amount period_start_at models allowed_ips expires_at status last_used_at created_at can_read_key can_manage can_edit desktop_managed")
				key := rawString(item["key"])
				mask := "****"
				if len(key) > 8 {
					mask += key[len(key)-4:]
				}
				items[i]["key"], _ = json.Marshal(mask)
			case isLogs:
				items[i] = keepConsoleFields(item, "id model request_id request_path created_at status error_message token_name token_id user_id username team_id team_name request_time is_stream first_byte_time prompt_tokens completion_tokens cache_read_tokens cache_creation_tokens cache_creation_1h_tokens usage_known cost group_discount_rate billing_type input_price output_price cache_read_price cache_creation_price cache_creation_1h_price call_price client_ip client_country client_platform client_device_id client_city client_network user_agent")
			case isGroups:
				items[i] = keepConsoleFields(item, "id name description status is_default discount_rate priority sort_order subscription_only type")
			}
		}
		var err error
		list["items"], err = json.Marshal(items)
		if err != nil {
			return nil, err
		}
		return json.Marshal(list)
	}
	// Never advertise platform inspection rights within a customer workspace.
	if strings.HasPrefix(path, "/api/team/") && !strings.Contains(strings.TrimPrefix(path, "/api/team/"), "/") || strings.HasPrefix(path, "/api/team/resolve/") {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		var clean func(any)
		clean = func(v any) {
			switch x := v.(type) {
			case []any:
				for _, item := range x {
					clean(item)
				}
			case map[string]any:
				delete(x, "platform_access")
				if x["role"] == float64(1) {
					delete(x, "balance")
					delete(x, "used_amount")
					delete(x, "allocated_member_quota")
				}
			}
		}
		clean(value)
		return json.Marshal(value)
	}
	return raw, nil
}
