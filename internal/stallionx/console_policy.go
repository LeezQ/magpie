package stallionx

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

type consoleRule struct {
	query, body string
	stream      bool
}

const consolePage = "page page_size"
const consoleLogFilters = consolePage + " workspace keyword model status token_id start_timestamp end_timestamp"
const consoleKeyFields = "name channel_group_ids quota period_type period_quota models allowed_ips expires_at"

var consoleID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var consoleKeyID = regexp.MustCompile(`^key_[a-f0-9]{32}$`)

func wordIn(words, word string) bool {
	return strings.Contains(" "+words+" ", " "+word+" ")
}

// Each path/method has its own input contract. Admin endpoints never match a
// prefix wildcard, even when the signed-in user also has a platform role.
func consolePolicy(method, path string) (consoleRule, bool) {
	r := consoleRule{}
	key := method + " " + path
	switch key {
	case "GET /api/user/self", "GET /api/user/self/discounts", "GET /api/user/self/identities",
		"GET /api/status", "GET /api/branding", "GET /api/payment/config", "GET /api/pricing/public",
		"GET /api/pricing/protocol-families", "GET /api/channel/protocols", "GET /api/team/mine",
		"GET /api/notification/self/unread", "GET /api/plan/available", "GET /api/subscription/current":
	case "GET /api/log/self", "GET /api/log/self/summary":
		r.query = consoleLogFilters
	case "GET /api/log/self/usage":
		r.query = "start end tz_offset"
	case "GET /api/token/":
		r.query = consolePage + " workspace"
	case "GET /api/payment/orders":
		r.query = consolePage + " status start_timestamp end_timestamp"
	case "GET /api/balance-log/self":
		r.query = consolePage + " type start_timestamp end_timestamp"
	case "GET /api/channel-group/":
		r.query = consolePage + " include_subscription_only"
	case "GET /api/channel/models":
		r.query = "group_id"
	case "GET /api/playground/models":
		r.query = "token_id workspace_id"
	case "GET /api/notification/self":
		r.query = consolePage + " status type unread_only"
	case "GET /api/subscription/logs":
		r.query = consolePage + " subscription_id"
	case "POST /api/payment/orders":
		r.body = "amount"
	case "POST /api/user/topup":
		r.body = "code"
	case "PUT /api/user/self":
		r.body = "username email verification_code locale"
	case "POST /api/user/self/email/verification":
		r.body = "email locale"
	case "PUT /api/user/self/password":
		r.body = "current_password new_password"
	case "POST /api/token/":
		r.body = consoleKeyFields + " team_id"
	case "PUT /api/token/":
		r.body = consoleKeyFields + " id status"
	case "POST /api/team/":
		r.body = "name"
	case "POST /api/team/join":
		r.body = "code"
	case "POST /api/notification/self/read-all", "DELETE /api/subscription/pending-change":
	case "POST /api/plan/purchase", "POST /api/subscription/change-plan":
		r.body = "plan_id months"
	case "POST /api/playground/chat", "POST /api/playground/messages":
		r.query = "token_id workspace_id"
		r.body = "model messages system stream stream_options temperature max_tokens top_p"
		r.stream = true
	default:
		parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
		for _, part := range parts {
			if !consoleID.MatchString(part) {
				return r, false
			}
		}
		switch {
		case len(parts) == 3 && parts[0] == "payment" && parts[1] == "orders" && method == "GET":
		case len(parts) == 2 && parts[0] == "task" && method == "GET":
		case len(parts) == 2 && parts[0] == "token" && consoleKeyID.MatchString(parts[1]) && (method == "GET" || method == "DELETE"):
		case len(parts) == 3 && parts[0] == "token" && consoleKeyID.MatchString(parts[1]) && parts[2] == "sources" && method == "GET":
		case len(parts) == 4 && parts[0] == "notification" && parts[1] == "self" && parts[3] == "read" && method == "POST":
		case len(parts) == 3 && parts[0] == "team" && (parts[1] == "resolve" || parts[1] == "invitation") && method == "GET":
		case len(parts) >= 2 && parts[0] == "team" && strings.HasPrefix(parts[1], "team_"):
			return consoleTeamPolicy(method, parts[2:])
		default:
			return r, false
		}
	}
	return r, true
}

func consoleTeamPolicy(method string, tail []string) (consoleRule, bool) {
	r := consoleRule{}
	if len(tail) > 1 && tail[0] == "tokens" && !consoleKeyID.MatchString(tail[1]) {
		return r, false
	}
	path := strings.Join(tail, "/")
	switch method + " " + path {
	case "GET ", "DELETE ":
	case "PUT ":
		r.body = "name max_members"
	case "GET tokens", "GET members", "GET invitations":
		r.query = consolePage
	case "GET logs", "GET logs/summary":
		r.query = consoleLogFilters + " user_id"
	case "GET logs/export":
		r.query = consoleLogFilters + " user_id tz_offset"
	case "GET stat/export":
		r.query = "start_timestamp end_timestamp tz_offset group_by user_id"
	case "GET balance-logs/export":
		r.query = "start_timestamp end_timestamp tz_offset type"
	case "GET usage", "GET stat":
		r.query = "start end tz_offset group_by"
	case "GET balance-logs":
		r.query = consolePage + " type"
	case "GET activity":
		r.query = consolePage + " action actor_id start_timestamp end_timestamp"
	case "POST transfer-in", "POST transfer-out":
		r.body = "amount"
	case "POST transfer-ownership":
		r.body = "new_owner_user_id"
	case "POST invitations":
		r.body = "role expires_in_hours max_uses"
	case "POST members":
		r.body = "username email password verification_code role locale"
	case "POST members/verification":
		r.body = "email locale turnstile_token"
	default:
		switch {
		case len(tail) == 2 && tail[0] == "members" && method == "DELETE":
		case len(tail) == 2 && tail[0] == "members" && method == "PUT":
			r.body = "role"
		case len(tail) == 3 && tail[0] == "members" && tail[2] == "quota" && method == "PUT":
			r.body = "quota period_type period_quota"
		case len(tail) == 2 && tail[0] == "invitations" && method == "DELETE":
		case len(tail) == 2 && tail[0] == "tokens" && (method == "GET" || method == "DELETE"):
		case len(tail) == 2 && tail[0] == "tokens" && method == "PUT":
			r.body = consoleKeyFields + " id status"
		case len(tail) == 3 && tail[0] == "tokens" && tail[2] == "sources" && method == "GET":
		case len(tail) == 2 && tail[0] == "tasks" && method == "GET":
		default:
			return r, false
		}
	}
	return r, true
}

func (s *consoleSession) team(ctx context.Context, path string) (map[string]json.RawMessage, error) {
	raw, err := s.read(ctx, path)
	if err != nil {
		return nil, err
	}
	var team map[string]json.RawMessage
	if json.Unmarshal(raw, &team) != nil || rawInt(team["role"]) < 1 || rawInt(team["role"]) > 3 {
		return nil, consoleRefused("Team membership is required")
	}
	return team, nil
}

func rawInt(raw json.RawMessage) int {
	var n int
	_ = json.Unmarshal(raw, &n)
	return n
}

func rawString(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

func (s *consoleSession) authorize(ctx context.Context, method, path string, q url.Values, fields map[string]json.RawMessage) error {
	parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
	if strings.HasPrefix(path, "/api/playground/") {
		workspace := q.Get("workspace_id")
		if workspace != "" && workspace != "personal" {
			if !strings.HasPrefix(workspace, "team_") || !consoleID.MatchString(workspace) || q.Get("token_id") == "" {
				return consoleRefused("Team Playground requires a key from the active workspace")
			}
			team, err := s.team(ctx, "/api/team/"+workspace)
			if err != nil {
				return err
			}
			if rawInt(team["status"]) != 1 {
				return consoleRefused("This team is not active")
			}
		}
	}
	if len(parts) >= 2 && parts[0] == "team" && (strings.HasPrefix(parts[1], "team_") || parts[1] == "resolve") {
		teamPath := "/api/team/" + parts[1]
		if parts[1] == "resolve" {
			teamPath = path
		}
		team, err := s.team(ctx, teamPath)
		if err != nil {
			return err
		}
		role := rawInt(team["role"])
		if method != "GET" && rawInt(team["status"]) != 1 {
			return consoleRefused("This team is not active")
		}
		if method != "GET" && role < 2 && !(len(parts) >= 4 && parts[2] == "tokens") {
			leaving := false
			if method == "DELETE" && len(parts) == 4 && parts[2] == "members" {
				self, err := s.read(ctx, "/api/user/self")
				if err != nil {
					return err
				}
				var user map[string]json.RawMessage
				if err := json.Unmarshal(self, &user); err != nil {
					return err
				}
				leaving = rawString(user["id"]) == parts[3]
			}
			if !leaving {
				return consoleRefused("Team management permission is required")
			}
		}
		if (method == "DELETE" && len(parts) == 2 || strings.Contains(path, "/transfer-")) && role != 3 {
			return consoleRefused("Only the team owner can perform this operation")
		}
		if role == 1 {
			if strings.Contains(path, "/balance-logs") || strings.HasSuffix(path, "/activity") || strings.Contains(path, "/invitations") {
				return consoleRefused("Team management permission is required")
			}
			self, err := s.read(ctx, "/api/user/self")
			if err != nil {
				return err
			}
			var user map[string]json.RawMessage
			if err := json.Unmarshal(self, &user); err != nil {
				return err
			}
			if strings.HasSuffix(path, "/logs") || strings.HasSuffix(path, "/logs/summary") || strings.HasSuffix(path, "/logs/export") || strings.HasSuffix(path, "/stat/export") {
				q.Set("user_id", rawString(user["id"]))
			}
			// These upstream aggregate/member handlers grant extra read access to
			// platform admins. A customer console must not silently inherit it.
			if rawInt(user["role"]) >= 100 && (strings.HasSuffix(path, "/usage") || strings.HasSuffix(path, "/stat") || strings.HasSuffix(path, "/members")) {
				return consoleRefused("Member-scoped reporting for platform administrators requires a server update")
			}
		}
	}
	if method == "POST" && path == "/api/token/" && rawString(fields["team_id"]) != "" {
		id := rawString(fields["team_id"])
		if !consoleID.MatchString(id) || !strings.HasPrefix(id, "team_") {
			return consoleRefused("Invalid team identity")
		}
		team, err := s.team(ctx, "/api/team/"+id)
		if err != nil {
			return err
		}
		if rawInt(team["status"]) != 1 {
			return consoleRefused("This team is not active")
		}
	}
	keyID := ""
	if parts[0] == "token" && len(parts) > 1 && parts[1] != "" {
		keyID = parts[1]
	} else if method == "PUT" && path == "/api/token/" {
		keyID = rawString(fields["id"])
		if !consoleKeyID.MatchString(keyID) {
			return consoleRefused("Invalid key identity")
		}
	} else if strings.HasPrefix(path, "/api/playground/") {
		keyID = q.Get("token_id")
	}
	if keyID != "" {
		if !consoleKeyID.MatchString(keyID) {
			return consoleRefused("Invalid key identity")
		}
		// Unlike PUT/DELETE/sources, this endpoint is owner-only even for a
		// platform administrator. Never let platform privilege substitute for it.
		raw, err := s.read(ctx, "/api/token/"+keyID)
		if err != nil {
			return err
		}
		var key map[string]json.RawMessage
		if err := json.Unmarshal(raw, &key); err != nil {
			return err
		}
		if strings.HasPrefix(path, "/api/playground/") {
			workspace := q.Get("workspace_id")
			if workspace == "personal" {
				workspace = ""
			}
			if rawString(key["team_id"]) != workspace {
				return consoleRefused("The selected key belongs to a different workspace")
			}
		}
		if (method == "PUT" || method == "DELETE") && (keyHash(rawString(key["key"])) == s.account.KeyHash || desktopTeamKey(s.account, key)) {
			return consoleRefused("This key manages desktop access. Change its configuration through automatic setup recovery instead")
		}
	}
	if parts[0] == "task" || len(parts) == 4 && parts[0] == "team" && parts[2] == "tasks" {
		return s.authorizeTask(ctx, path, parts)
	}
	return nil
}

func (s *consoleSession) authorizeTask(ctx context.Context, path string, parts []string) error {
	raw, err := s.read(ctx, path)
	if err != nil {
		return err
	}
	var task map[string]json.RawMessage
	if err := json.Unmarshal(raw, &task); err != nil {
		return err
	}
	if parts[0] == "team" {
		if rawString(task["team_id"]) != parts[1] {
			return consoleRefused("Task does not belong to this workspace")
		}
		team, err := s.team(ctx, "/api/team/"+parts[1])
		if err != nil {
			return err
		}
		if rawInt(team["role"]) >= 2 {
			return nil
		}
	} else if rawString(task["team_id"]) != "" {
		return consoleRefused("Task does not belong to the personal workspace")
	}
	self, err := s.read(ctx, "/api/user/self")
	if err != nil {
		return err
	}
	var user map[string]json.RawMessage
	if err := json.Unmarshal(self, &user); err != nil {
		return err
	}
	if rawString(user["id"]) == "" || rawString(user["id"]) != rawString(task["user_id"]) {
		return consoleRefused("Task is not owned by this account")
	}
	return nil
}
