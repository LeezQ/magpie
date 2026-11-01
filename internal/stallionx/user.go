package stallionx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/provider"
)

// UserStatus is the one application account state, independently of whether
// model-service setup has finished. Only authenticated + ready opens workspace.
type UserStatus struct {
	State             string       `json:"state"`
	Setup             string       `json:"setup"`
	SetupMessage      string       `json:"setupMessage,omitempty"`
	SetupConflict     bool         `json:"setupConflict,omitempty"`
	ProviderConnected bool         `json:"providerConnected"`
	Email             string       `json:"email,omitempty"`
	Username          string       `json:"username,omitempty"`
	Service           string       `json:"service"`
	Terms             string       `json:"terms"`
	Privacy           string       `json:"privacy"`
	Profile           *UserProfile `json:"profile,omitempty"`
	Message           string       `json:"message,omitempty"`
	IsNew             bool         `json:"isNew,omitempty"`
}

// UserProfile deliberately excludes role, invite relationships and credentials.
// Fields come from Stallion's userToSafeMap/GetSelf public response.
type UserProfile struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	Balance       string `json:"balance"`
	UsedAmount    string `json:"usedAmount,omitempty"`
	GroupName     string `json:"groupName,omitempty"`
	// BillingMode preserves Stallion's integer enum: 0 = own wallet, 1 = agent
	// pool. Zero is meaningful, so it must also be sent to the webview.
	BillingMode  int    `json:"billingMode"`
	CreatedAt    string `json:"createdAt,omitempty"`
	Status       int    `json:"status"`
	ActiveTokens int    `json:"activeTokens"`
}

func readAccount() (saved, error) {
	b, err := os.ReadFile(accountFile())
	if err != nil {
		return saved{}, err
	}
	var s saved
	if err := json.Unmarshal(b, &s); err != nil {
		return s, err
	}
	if s.Email == "" || s.Service == "" {
		return s, errors.New("saved StallionX account is incomplete")
	}
	return s, nil
}

func writeAccount(s saved) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return edit.WriteAtomic(accountFile(), b)
}

func connected(s saved) bool {
	p, err := provider.Find(ProviderID)
	return err == nil && p.ID == ProviderID && p.Preset == ProviderID && len(p.Keys) == 0 && s.KeyHash != "" && keyHash(p.Key) == s.KeyHash && p.Chat == s.Service+"/v1" && p.Responses == s.Service+"/v1" && p.Anthropic == s.Service
}

func setupReady(s saved) bool {
	models, _, ok := catalog.Live(ProviderID)
	return connected(s) && s.Setup == "ready" && s.ModelCount > 0 && ok && len(models) > 0
}

func userBase() UserStatus {
	base := Base()
	return UserStatus{State: "signed_out", Setup: "failed", Service: base, Terms: base + "/terms", Privacy: base + "/privacy"}
}

// User verifies the account against Stallion. A missing provider means setup
// failed, never that an otherwise valid user is mysteriously logged out.
func User(ctx context.Context) UserStatus {
	return userWithRetry(ctx, 1)
}

func userWithRetry(ctx context.Context, retries int) UserStatus {
	out := userBase()
	s, err := readAccount()
	if os.IsNotExist(err) {
		return out
	}
	if err != nil {
		out.State = "unavailable"
		out.Message = err.Error()
		return out
	}
	if s.Service != Base() {
		return out
	}
	out.Email, out.Username = s.Email, s.Username
	out.ProviderConnected = connected(s)
	out.SetupConflict = setupConflict(s)
	out.SetupMessage = s.SetupMessage
	if setupReady(s) {
		out.Setup = "ready"
	}
	raw, requestErr := accountRequest(ctx, http.MethodGet, "/api/user/self", nil)
	var profile UserProfile
	if requestErr == nil {
		profile, requestErr = decodeProfile(raw)
	}
	// A late response belongs to the login it began with, including a 401.
	// Revalidate a replacement login instead of showing it as signed out.
	now, err := readAccount()
	if os.IsNotExist(err) {
		return userBase()
	}
	if err != nil {
		out.State = "unavailable"
		out.Message = err.Error()
		return out
	}
	if now.At != s.At || now.Email != s.Email || now.Service != s.Service {
		if retries > 0 {
			return userWithRetry(ctx, retries-1)
		}
		out = userBase()
		out.State = "unavailable"
		out.Message = "StallionX account changed during verification; try again"
		return out
	}
	if requestErr != nil {
		out.State = "unavailable"
		out.Message = requestErr.Error()
		if errors.Is(requestErr, ErrWalletSession) {
			out.State = "expired"
		}
		return out
	}
	out.State = "authenticated"
	out.ProviderConnected = connected(now)
	out.SetupConflict = setupConflict(now)
	out.Setup = "failed"
	out.SetupMessage = now.SetupMessage
	if setupReady(now) {
		out.Setup = "ready"
	}
	out.Profile = &profile
	out.Email = profile.Email
	out.Username = profile.Username
	return out
}

var moneyRe = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`)

func decodeProfile(raw json.RawMessage) (UserProfile, error) {
	var in struct {
		ID            json.RawMessage `json:"id"`
		Username      string          `json:"username"`
		Email         string          `json:"email"`
		EmailVerified bool            `json:"email_verified"`
		Balance       json.RawMessage `json:"balance"`
		UsedAmount    json.RawMessage `json:"used_amount"`
		GroupName     string          `json:"group_name"`
		BillingMode   int             `json:"billing_mode"`
		CreatedAt     string          `json:"created_at"`
		Status        int             `json:"status"`
		ActiveTokens  int             `json:"active_tokens"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return UserProfile{}, err
	}
	balance := balanceOf(in.Balance)
	if in.Email == "" || in.Username == "" || balance == "" {
		return UserProfile{}, errors.New("StallionX returned incomplete user information")
	}
	if !moneyRe.MatchString(balance) {
		return UserProfile{}, errors.New("StallionX returned an invalid balance")
	}
	return UserProfile{ID: balanceOf(in.ID), Username: in.Username, Email: in.Email, EmailVerified: in.EmailVerified, Balance: balance, UsedAmount: balanceOf(in.UsedAmount), GroupName: in.GroupName, BillingMode: in.BillingMode, CreatedAt: in.CreatedAt, Status: in.Status, ActiveTokens: in.ActiveTokens}, nil
}

var accessCache struct {
	sync.Mutex
	key    string
	until  time.Time
	status UserStatus
}

func invalidateAccess() { accessCache.Lock(); accessCache.until = time.Time{}; accessCache.Unlock() }

func cloneUser(out UserStatus) UserStatus {
	if out.Profile != nil {
		profile := *out.Profile
		out.Profile = &profile
	}
	return out
}

// Access bounds remote authorization freshness to ten seconds while tying every
// reuse to local account/session/setup changes, including another process logout.
func Access(ctx context.Context) UserStatus {
	a, ae := os.ReadFile(accountFile())
	s, se := os.ReadFile(walletFile())
	key := keyHash(string(a) + string(s))
	if ae != nil || se != nil {
		return User(ctx)
	}
	savedAccount, err := readAccount()
	if err != nil {
		return User(ctx)
	}
	key += fmt.Sprint(connected(savedAccount), setupReady(savedAccount))
	accessCache.Lock()
	if key == accessCache.key && time.Now().Before(accessCache.until) {
		out := cloneUser(accessCache.status)
		accessCache.Unlock()
		return out
	}
	accessCache.Unlock()
	out := User(ctx)
	accessCache.Lock()
	accessCache.key = key
	accessCache.status = cloneUser(out)
	accessCache.until = time.Now().Add(10 * time.Second)
	accessCache.Unlock()
	return out
}

var setupMu sync.Mutex

// SyncAccount idempotently provisions the named key and fetches available models.
// Authentication survives setup errors; workspace stays closed until a retry succeeds.
func SyncAccount(ctx context.Context) UserStatus {
	setupMu.Lock()
	defer setupMu.Unlock()
	return syncAccount(ctx)
}

func syncAccount(ctx context.Context) UserStatus {
	s, err := readAccount()
	if err != nil {
		return User(ctx)
	}
	finish := func(problem error) UserStatus {
		mu.Lock()
		now, e := readAccount()
		if e == nil && now.At == s.At && now.Email == s.Email && now.Service == s.Service {
			now.Setup = "ready"
			now.SetupMessage = ""
			if problem != nil {
				now.Setup = "failed"
				now.SetupMessage = problem.Error()
			}
			if e = writeAccount(now); e != nil {
				problem = e
			}
		}
		invalidateAccess()
		mu.Unlock()
		out := User(ctx)
		if problem != nil {
			out.Setup = "failed"
			out.SetupMessage = problem.Error()
		}
		return out
	}
	raw, err := accountRequest(ctx, http.MethodPost, "/api/cli/provision", map[string]string{"name": tokenName})
	if err != nil {
		return finish(err)
	}
	var prov provisionData
	if err := json.Unmarshal(raw, &prov); err != nil {
		return finish(err)
	}
	if prov.Key == "" {
		return finish(errors.New("StallionX returned no model service key"))
	}
	mu.Lock()
	now, e := readAccount()
	if e != nil || now.At != s.At || now.Email != s.Email || now.Service != s.Service {
		mu.Unlock()
		return User(ctx)
	}
	session, e := readSession(statusOf(now, true), now.KeyHash)
	if e == nil {
		e = saveProvider(now.Service, prov.Key, now.KeyHash)
	}
	if e == nil {
		now.KeyHash = keyHash(prov.Key)
		now.Balance = balanceOf(prov.Balance)
		now.Setup = "failed"
		now.SetupMessage = "Model list synchronization is incomplete"
		now.ModelCount = 0
		e = writeAccount(now)
		if e == nil {
			e = saveWallet(session.Token, session.Refresh, now)
		}
	}
	mu.Unlock()
	if e != nil {
		return finish(e)
	}
	p, e := provider.Find(ProviderID)
	if e != nil {
		return finish(e)
	}
	models, e := p.Fetch(ctx)
	if e != nil {
		return finish(e)
	}
	if len(models) == 0 {
		return finish(errors.New("StallionX returned no available models"))
	}
	mu.Lock()
	now, e = readAccount()
	if e == nil && now.At == s.At {
		now.ModelCount = len(models)
		e = writeAccount(now)
	}
	mu.Unlock()
	return finish(e)
}
