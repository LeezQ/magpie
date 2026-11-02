package stallionx

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// consoleSession pins a whole operation (including authorization preflights) to
// one login. Refresh and managed-key repair do not create a different account.
type consoleSession struct {
	account saved
	token   string
	// desktopKey is set when this request edits one of the desktop app's own
	// keys, as desktopKeyOf names it ("personal" or a team's public id), once
	// the key has been read and the change allowed (desktopKeyChange). After
	// the edit succeeds, that key's provider fetches its models again.
	desktopKey string
}

// refreshAfterEdit refetches the models of the desktop key this request
// edited, if it edited one (s.desktopKey). It is called once the service has
// accepted the edit, and is given its own time: a page closed while the save
// answers must not leave the Providers list on the old models.
func (s *consoleSession) refreshAfterEdit(r *http.Request) {
	if s.desktopKey == "" || r.Method != http.MethodPut {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 30*time.Second)
	defer cancel()
	// refreshDesktopModels logs its own failure; the save stands either way
	_ = refreshDesktopModels(ctx, s.account, s.desktopKey)
}

func consoleBinding(s saved) string {
	h := sha256.Sum256([]byte(s.At.Format(time.RFC3339Nano) + "\n" + s.Service + "\n" + s.Email))
	return hex.EncodeToString(h[:])
}

func consoleSnapshot(binding string) (*consoleSession, error) {
	mu.Lock()
	defer mu.Unlock()
	s, err := readAccount()
	if err != nil || s.Service != Base() || (binding != "" && binding != consoleBinding(s)) {
		return nil, ErrWalletSession
	}
	session, err := readSession(statusOf(s, true), s.KeyHash)
	if err != nil {
		return nil, ErrWalletSession
	}
	return &consoleSession{account: s, token: session.Token}, nil
}

func (s *consoleSession) valid() bool {
	now, err := consoleSnapshot(consoleBinding(s.account))
	return err == nil && now != nil
}

// ConsoleBinding authenticates the native bootstrap without depending on model
// setup: an account with no usable provider must still be able to recharge.
func ConsoleBinding(ctx context.Context) (string, error) {
	s, err := consoleSnapshot("")
	if err != nil {
		return "", err
	}
	if _, err = s.read(ctx, "/api/user/self"); err != nil {
		return "", err
	}
	return consoleBinding(s.account), nil
}

func (s *consoleSession) read(ctx context.Context, path string) (json.RawMessage, error) {
	if !s.valid() {
		return nil, ErrWalletSession
	}
	var out json.RawMessage
	err := request(ctx, http.MethodGet, s.account.Service, path, s.token, nil, &out)
	var refused *serviceError
	if errors.As(err, &refused) && refused.status == http.StatusUnauthorized && s.valid() {
		s.token, err = renewWallet(ctx, statusOf(s.account, true), s.account.KeyHash, s.token)
		if err == nil && s.valid() {
			err = request(ctx, http.MethodGet, s.account.Service, path, s.token, nil, &out)
		}
	}
	if !s.valid() {
		return nil, ErrWalletSession
	}
	if errors.As(err, &refused) && refused.status == http.StatusUnauthorized {
		return nil, ErrWalletSession
	}
	return out, err
}

func consoleFailure(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	var refused *serviceError
	if errors.Is(err, ErrWalletSession) {
		status = http.StatusUnauthorized
	} else if errors.As(err, &refused) && refused.status >= 400 && refused.status <= 599 {
		status = refused.status
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "message": err.Error()})
}

func consoleRefused(message string) error {
	return &serviceError{status: http.StatusForbidden, message: message}
}

// ConsoleServe is a customer BFF, not a general reverse proxy. The GUI has
// already checked its capability; this boundary checks login, route and scope.
func ConsoleServe(w http.ResponseWriter, r *http.Request, binding string) {
	w.Header().Set("Cache-Control", "no-store")
	s, err := consoleSnapshot(binding)
	if err != nil {
		consoleFailure(w, err)
		return
	}
	policy, ok := consolePolicy(r.Method, r.URL.Path)
	if !ok {
		consoleFailure(w, consoleRefused("This operation is not available in the desktop account console"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 {
		consoleFailure(w, &serviceError{status: 400, message: "Account request is too large or incomplete"})
		return
	}
	fields := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(body)) > 0 && (json.Unmarshal(body, &fields) != nil || fields == nil) {
		consoleFailure(w, &serviceError{status: 400, message: "Expected a JSON object"})
		return
	}
	for key := range fields {
		if !wordIn(policy.body, key) {
			consoleFailure(w, consoleRefused("Unsupported account field: "+key))
			return
		}
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		consoleFailure(w, consoleRefused("Invalid account query"))
		return
	}
	for key, values := range q {
		if !wordIn(policy.query, key) || len(values) != 1 {
			consoleFailure(w, consoleRefused("Unsupported account filter: "+key))
			return
		}
	}
	if r.URL.Path == "/api/token/" && r.Method == http.MethodGet || strings.HasPrefix(r.URL.Path, "/api/log/self") {
		q.Set("workspace", "personal")
	}
	if err := s.authorize(r.Context(), r.Method, r.URL.Path, q, fields); err != nil {
		consoleFailure(w, err)
		return
	}
	if !s.valid() {
		consoleFailure(w, ErrWalletSession)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/"), "/")
	if len(parts) >= 4 && parts[0] == "team" && parts[2] == "tokens" {
		s.serveTeamKey(w, r, parts, fields)
		return
	}
	path := r.URL.Path
	q.Del("workspace_id")
	if len(parts) == 4 && parts[0] == "team" && parts[2] == "members" && parts[3] == "verification" {
		path = "/api/user/verification"
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	if r.Method == http.MethodGet {
		beforeScope, scopeErr := s.scopeStamp(r.Context(), parts)
		if scopeErr != nil {
			consoleFailure(w, scopeErr)
			return
		}
		out, err := s.read(r.Context(), path)
		if err == nil && beforeScope != "" {
			afterScope, scopeErr := s.scopeStamp(r.Context(), parts)
			if scopeErr != nil {
				err = scopeErr
			} else if beforeScope != afterScope {
				err = consoleRefused("Team permissions changed; reload this workspace")
			}
		}
		if err == nil && (r.URL.Path == "/api/token/" || strings.HasSuffix(r.URL.Path, "/tokens")) {
			out, err = markConsoleManagedKey(out, s.account)
		}
		if err == nil {
			out, err = consolePublicData(r.URL.Path, out)
		}
		if err != nil {
			consoleFailure(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": out})
		return
	}
	// Validate/renew with a read before a mutation. Never replay a paid POST,
	// even on a 401: the caller can re-read the authoritative result and retry.
	if _, err := s.read(r.Context(), "/api/user/self"); err != nil {
		consoleFailure(w, err)
		return
	}
	if policy.stream {
		s.stream(w, r, path, body)
		return
	}
	var out json.RawMessage
	err = request(r.Context(), r.Method, s.account.Service, path, s.token, fields, &out)
	if !s.valid() {
		err = ErrWalletSession
	}
	if err != nil {
		consoleFailure(w, err)
		return
	}
	if r.Method == "PUT" && r.URL.Path == "/api/token/" {
		// Upstream may echo the full key from a configuration save. Only
		// creation and explicit reveal may deliver a credential to this origin.
		out = nil
	}
	// an edited desktop key: its provider lists what the key gives now before
	// the page hears the save went through
	s.refreshAfterEdit(r)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": out})
}

func (s *consoleSession) scopeStamp(ctx context.Context, parts []string) (string, error) {
	if len(parts) < 2 || parts[0] != "team" || (!strings.HasPrefix(parts[1], "team_") && parts[1] != "resolve") {
		return "", nil
	}
	path := "/api/team/" + parts[1]
	if parts[1] == "resolve" && len(parts) == 3 {
		path += "/" + parts[2]
	}
	team, err := s.team(ctx, path)
	if err != nil {
		return "", err
	}
	return string(team["id"]) + ":" + string(team["role"]) + ":" + string(team["status"]), nil
}

func (s *consoleSession) stream(w http.ResponseWriter, r *http.Request, path string, body []byte) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	// Account replacement cancels an already-running billable stream too.
	go func() {
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if !s.valid() {
					cancel()
					return
				}
			}
		}
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.account.Service+path, bytes.NewReader(body))
	if err != nil {
		consoleFailure(w, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Content-Type", "application/json")
	c := *client
	c.Timeout = 0
	res, err := c.Do(req)
	if err != nil {
		consoleFailure(w, errors.New("StallionX stream could not be started; inspect request logs before retrying"))
		return
	}
	defer res.Body.Close()
	if !s.valid() {
		consoleFailure(w, ErrWalletSession)
		return
	}
	w.Header().Set("Content-Type", res.Header.Get("Content-Type"))
	w.WriteHeader(res.StatusCode)
	buf := make([]byte, 16<<10)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if !s.valid() {
				return
			}
			if _, err := w.Write(buf[:n]); err != nil {
				return
			}
			_ = http.NewResponseController(w).Flush()
		}
		if err != nil {
			return
		}
	}
}
