package stallionx

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// A customer team-key operation never uses the platform key-reveal endpoint.
// Locate the key inside the server-authorized team list, then let the upstream
// transactional mutation recheck membership/role when it takes the team lock.
func (s *consoleSession) teamKey(ctx context.Context, teamID, id string) (map[string]json.RawMessage, error) {
	for page := 1; page <= 100; page++ {
		raw, err := s.read(ctx, fmt.Sprintf("/api/team/%s/tokens?page=%d&page_size=100", teamID, page))
		if err != nil {
			return nil, err
		}
		var list struct {
			Items []map[string]json.RawMessage `json:"items"`
			Total int                          `json:"total"`
		}
		if err := json.Unmarshal(raw, &list); err != nil {
			return nil, err
		}
		for _, key := range list.Items {
			if rawString(key["id"]) == id && rawString(key["team_id"]) == teamID {
				return key, nil
			}
		}
		if page*100 >= list.Total || len(list.Items) == 0 {
			break
		}
	}
	return nil, &serviceError{status: 404, message: "Key is not available in this workspace"}
}

func (s *consoleSession) serveTeamKey(w http.ResponseWriter, r *http.Request, parts []string, fields map[string]json.RawMessage) {
	before, err := s.scopeStamp(r.Context(), parts)
	if err != nil {
		consoleFailure(w, err)
		return
	}
	key, err := s.teamKey(r.Context(), parts[1], parts[3])
	if err != nil {
		consoleFailure(w, err)
		return
	}
	// The desktop's own team key is set up and kept by the payers here
	// (payers.go); editing or deleting it in the console would break the
	// agents set to that team, as with the personal desktop key.
	if (r.Method == "PUT" || r.Method == "DELETE") && desktopTeamKey(s.account, key) {
		consoleFailure(w, consoleRefused("This key manages desktop access. Remove the team from this computer in the account page instead"))
		return
	}
	var out json.RawMessage
	if r.Method == "GET" && len(parts) == 4 {
		out, err = json.Marshal(key)
	} else {
		path := "/api/token/" + parts[3]
		if len(parts) == 5 {
			path += "/sources"
		}
		if r.Method == "PUT" {
			path = "/api/token/"
			fields["id"] = key["id"]
		}
		if r.Method == "GET" {
			out, err = s.read(r.Context(), path)
		} else {
			// The server accepts only status changes on another member's key.
			// It rechecks this permission in its transaction, not just in this BFF.
			if _, err = s.read(r.Context(), "/api/user/self"); err == nil {
				err = request(r.Context(), r.Method, s.account.Service, path, s.token, fields, &out)
			}
		}
	}
	if !s.valid() {
		err = ErrWalletSession
	}
	if err == nil {
		after, scopeErr := s.scopeStamp(r.Context(), parts)
		if scopeErr != nil {
			err = scopeErr
		} else if before != after {
			err = consoleRefused("Team permissions changed; reload this workspace")
		}
	}
	if err != nil {
		consoleFailure(w, err)
		return
	}
	if r.Method == "PUT" {
		out = nil
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": out})
}
