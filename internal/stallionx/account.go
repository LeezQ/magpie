// Package stallionx signs this app in to the StallionX service and keeps
// the built-in StallionX provider that its requests go through.
//
// Signing in is by email and a one-time code, and an address the service
// doesn't know yet is registered on the spot (the service's
// POST /api/user/email-login): there is no separate sign-up and no
// password. The steps:
//
//  1. SendCode asks the service to mail a code (POST /api/user/verification).
//  2. SignIn trades the email and code for a short-lived access token
//     (POST /api/user/email-login), then the token for the account's API key
//     (POST /api/cli/provision, which hands back the same key each time).
//  3. The key is saved as the provider ProviderID in providers.json, with
//     the service's OpenAI (/v1) and Anthropic (root) endpoints, so every
//     agent the app connects can use StallionX's models at once.
//
// Account sessions are saved separately with owner-only permissions for
// restart recovery and refresh. Metadata contains no secrets; the API key
// lives where every provider's key does.
package stallionx

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/brand"
	"github.com/yetone/magpie/internal/netproxy"
	"github.com/yetone/magpie/internal/provider"
)

// ProviderID is the id of the built-in provider the sign-in keeps. It is
// also the preset's (provider.StallionXPreset) and the icon's name.
const ProviderID = provider.StallionXPreset

// tokenName is the name the key is provisioned under on the service. The
// service hands back the key of that name when it has one (the call is
// idempotent), so signing in again, here or on another computer, reuses
// it rather than adding a key each time. Changing it would give every user
// a second key on their next sign-in.
const tokenName = brand.Name + " 客户端"

// Base is the address of the StallionX service: brand.ServiceURL, or
// STALLIONX_URL for a service of one's own (a local Stallion-X while
// developing), without a trailing slash.
func Base() string {
	if u := strings.TrimSpace(os.Getenv("STALLIONX_URL")); u != "" {
		return strings.TrimRight(u, "/")
	}
	return strings.TrimRight(brand.ServiceURL, "/")
}

// Status is what the app's page shows of the StallionX account.
type Status struct {
	// SignedIn: an account is saved and its provider is here with a key.
	SignedIn bool `json:"signedIn"`
	// Email and Username are the account's, as the service gave them.
	Email    string `json:"email,omitempty"`
	Username string `json:"username,omitempty"`
	// Service is the address signed in at (Base when signed out).
	Service string `json:"service"`
	// ProviderID is the provider the account's key is saved as.
	ProviderID string `json:"providerId"`
	// IsNew is set on the SignIn that registered the address.
	IsNew bool `json:"isNew,omitempty"`
	// Balance is the account's balance in dollars when it signed in, as
	// the service said it; the Usage page reads it fresh from then on.
	Balance string `json:"balance,omitempty"`
	// Terms and Privacy are the service's pages a sign-in agrees to.
	Terms   string `json:"terms"`
	Privacy string `json:"privacy"`
}

// CodeSent is what SendCode answers.
type CodeSent struct {
	// TestCode is the code itself, when the service runs without mail (its
	// test mode hands it back instead of sending it): the page fills it in.
	TestCode string `json:"testCode,omitempty"`
}

// saved is account.json: who is signed in, never a secret.
type saved struct {
	Email        string    `json:"email"`
	Username     string    `json:"username"`
	Service      string    `json:"service"`
	Balance      string    `json:"balance,omitempty"`
	At           time.Time `json:"at"`
	KeyHash      string    `json:"keyHash"`
	Setup        string    `json:"setup,omitempty"`
	SetupMessage string    `json:"setupMessage,omitempty"`
	ModelCount   int       `json:"modelCount,omitempty"`
}

// mu keeps a sign-in and a sign-out from interleaving their writes of
// account.json and providers.json.
var mu sync.Mutex

// loginGeneration is protected by mu. A later login or sign-out cancels an
// earlier login's network completion before it can recreate local credentials.
var loginGeneration uint64

// accountFile is where saved is kept, in the app's own folder.
func accountFile() string { return filepath.Join(appdir.Config(), "stallionx-account.json") }

// emailRe is a plain check, so an address with no @ is caught here rather
// than by the service; the service's check is the one that counts.
var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// client asks the service through the proxy the rest of the app's requests
// take (Settings' Proxy, else the environment's or the system's).
var client = &http.Client{Timeout: 30 * time.Second, Transport: proxied(),
	// Authentication POST bodies must never follow a redirect to another host.
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

func proxied() http.RoundTripper {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = netproxy.Func
	return netproxy.Dispatch(t)
}

// envelope is the service's answer to its /api/* calls.
type envelope struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type serviceError struct {
	status  int
	message string
}

func (e *serviceError) Error() string { return e.message }

// call posts body as JSON to path on base, with the access token when one
// is given, and decodes the answer's data into out. An answer the service
// marks unsuccessful is an error carrying its message, which is written
// for people (in Chinese), so the page shows it as it is.
func call(ctx context.Context, base, path, token string, body, out any) error {
	return request(ctx, http.MethodPost, base, path, token, body, out)
}

func request(ctx context.Context, method, base, path, token string, body, out any) error {
	return sessionRequest(ctx, method, base, path, token, body, out, nil)
}

func sessionRequest(ctx context.Context, method, base, path, token string, body, out any, refresh *string) error {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) {
		return errors.New("StallionX URL must use HTTPS (HTTP is allowed only on loopback for development)")
	}
	b, err := json.Marshal(body)
	if err != nil {
		log.Printf("stallionx: encoding %s: %v", path, err)
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, bytes.NewReader(b))
	if err != nil {
		log.Printf("stallionx: building %s: %v", path, err)
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if refresh != nil && *refresh != "" {
		req.AddCookie(&http.Cookie{Name: "stallion_refresh_token", Value: *refresh})
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := client.Do(req)
	if err != nil {
		log.Printf("stallionx: %s: %v", path, err)
		return fmt.Errorf("couldn't reach %s: %w", base, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		log.Printf("stallionx: reading %s: %v", path, err)
		return fmt.Errorf("couldn't read %s's answer: %w", base, err)
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		// a proxy's page, or a gateway error with no JSON: its status says
		// more than the body
		log.Printf("stallionx: %s answered %s, not JSON: %v", path, res.Status, err)
		return fmt.Errorf("%s answered %s", base, res.Status)
	}
	if res.StatusCode != http.StatusOK || !env.Success {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = res.Status
		}
		log.Printf("stallionx: %s refused (%s): %s", path, res.Status, msg)
		return &serviceError{status: res.StatusCode, message: msg}
	}
	if out == nil || len(env.Data) == 0 {
		return nil
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		log.Printf("stallionx: decoding %s's data: %v", path, err)
		return fmt.Errorf("%s's answer to %s isn't what %s expects", base, path, brand.Name)
	}
	if refresh != nil {
		for _, c := range res.Cookies() {
			if c.Name == "stallion_refresh_token" {
				*refresh = c.Value
			}
		}
	}
	return nil
}

// checkEmail trims email and says whether it looks like an address.
func checkEmail(email string) (string, error) {
	email = strings.TrimSpace(email)
	if !emailRe.MatchString(email) {
		return "", errors.New("enter an email address")
	}
	return email, nil
}

// SendCode asks the service to mail a sign-in code to email, in locale
// ("zh-CN" or "en"; another is left to the service to pick).
func SendCode(ctx context.Context, email, locale string) (CodeSent, error) {
	email, err := checkEmail(email)
	if err != nil {
		return CodeSent{}, err
	}
	var out struct {
		Code string `json:"code"`
	}
	if err := call(ctx, Base(), "/api/user/verification", "", map[string]string{"email": email, "locale": locale}, &out); err != nil {
		return CodeSent{}, err
	}
	return CodeSent{TestCode: out.Code}, nil
}

// loginData is the part of /api/user/email-login's answer read here.
type loginData struct {
	Token string `json:"token"`
	User  struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	} `json:"user"`
	IsNew bool `json:"is_new"`
}

// provisionData is the part of /api/cli/provision's answer read here.
type provisionData struct {
	Key      string          `json:"key"`
	Username string          `json:"username"`
	Balance  json.RawMessage `json:"balance"`
}

// SignIn signs in with email and the code mailed to it, registering the
// address if the service doesn't know it, and saves the account's key as
// the StallionX provider. inviteCode is optional (a referral). The page is
// to have shown the service's terms (Status.Terms) before: signing in
// agrees to them.
func SignIn(ctx context.Context, email, code, inviteCode, locale string) (Status, error) {
	email, err := checkEmail(email)
	if err != nil {
		return Status{}, err
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return Status{}, errors.New("enter the code from the email")
	}
	mu.Lock()
	loginGeneration++
	generation := loginGeneration
	mu.Unlock()
	base := Base()
	body := map[string]any{"email": email, "verification_code": code, "locale": locale, "agree_terms": true, "remember_me": true}
	if s := strings.TrimSpace(inviteCode); s != "" {
		body["invite_code"] = s
	}
	var login loginData
	var refresh string
	if err := sessionRequest(ctx, http.MethodPost, base, "/api/user/email-login", "", body, &login, &refresh); err != nil {
		return Status{}, err
	}
	if login.Token == "" {
		log.Printf("stallionx: email-login answered no token")
		return Status{}, fmt.Errorf("%s signed in but gave no token", base)
	}

	mu.Lock()
	if generation != loginGeneration {
		mu.Unlock()
		return Status{}, errors.New("this sign-in was superseded by a newer account action")
	}
	s := saved{Email: firstOf(login.User.Email, email), Username: login.User.Username, Service: base, At: time.Now(), Setup: "failed", SetupMessage: "Account setup is incomplete"}
	if old, e := readAccount(); e == nil && old.Service == base {
		s.KeyHash = old.KeyHash
	}
	if err := os.MkdirAll(appdir.Config(), 0700); err != nil {
		mu.Unlock()
		return Status{}, err
	}
	if err := writeAccount(s); err != nil {
		mu.Unlock()
		return Status{}, err
	}
	if err := saveWallet(login.Token, refresh, s); err != nil {
		mu.Unlock()
		return Status{}, fmt.Errorf("signed in, but account session could not be saved: %w", err)
	}
	invalidateAccess()
	mu.Unlock()
	SyncAccount(ctx)
	st := Current()
	st.IsNew = login.IsNew
	return st, nil
}

// saveProvider saves key as the StallionX provider at base, keeping what
// the user set on one saved before (model picks, its name, routing) and
// replacing its endpoints and key, which the sign-in owns.
func saveProvider(base, key, previousHash string) error {
	p, err := provider.FromPreset(ProviderID)
	if err != nil {
		log.Printf("stallionx: the %s preset: %v", ProviderID, err)
		return err
	}
	if err := provider.FileError(); err != nil {
		return err
	}
	if o, err := provider.Find(ProviderID); err == nil && o.ID == ProviderID {
		// Never replace a manually managed provider or erase extra keys.
		if o.Preset != ProviderID || len(o.Keys) != 0 || previousHash == "" || keyHash(o.Key) != previousHash {
			return errors.New("the stallionx provider contains custom credentials; rename it before signing in")
		}
		p = *o
	}
	p.ID, p.Preset = ProviderID, ProviderID
	if p.Name == "" {
		p.Name = brand.Name
	}
	p.Icon = ProviderID
	p.Chat, p.Responses, p.Anthropic = base+"/v1", base+"/v1", base
	p.Website, p.KeysURL = base, base+"/personal/token"
	// one key, the account's: keys added beside it by hand would belong to
	// another account, which a sign-out wouldn't take away
	p.Key, p.Keys = key, nil
	// new-api's query for what is left on a key, which StallionX answers
	p.BalanceURL = base + "/api/usage/token"
	if err := provider.Save(p); err != nil {
		return err
	}
	provider.ForgetBalances()

	return nil
}

// SignOut forgets the account and removes the StallionX provider and its
// key from this computer. The key stays on the service, where the next
// sign-in finds it again.
func SignOut() (Status, error) {
	mu.Lock()
	loginGeneration++
	invalidateAccess()
	s, readErr := readAccount()
	var session accountSession
	if readErr == nil {
		session, _ = readSession(statusOf(s, true), s.KeyHash)
	}
	// Clear authorization even if a provider has been edited outside this login.
	// Such credentials are not ours and remain untouched, but cannot keep the app logged in.
	if err := os.Remove(walletFile()); err != nil && !os.IsNotExist(err) {
		mu.Unlock()
		return Status{}, err
	}
	forgetWallet()
	if err := os.Remove(accountFile()); err != nil && !os.IsNotExist(err) {
		mu.Unlock()
		return Status{}, err
	}
	if readErr == nil && provider.FileError() == nil && connected(s) {
		if err := provider.Delete(ProviderID); err != nil {
			log.Printf("stallionx: removing signed-out model service: %v", err)
		}
	}
	mu.Unlock()
	if session.Refresh != "" && session.Service == Base() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := sessionRequest(ctx, http.MethodPost, session.Service, "/api/user/logout", "", map[string]any{}, nil, &session.Refresh); err != nil {
			log.Printf("stallionx: remote session revocation unavailable: %v", err)
		}
		cancel()
	}
	return statusOf(saved{}, false), nil
}

// Current is legacy provider metadata, not authentication. User and Access
// verify the independent account session even if the provider is missing.
func Current() Status {
	b, err := os.ReadFile(accountFile())
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("stallionx: reading %s: %v", accountFile(), err)
		}
		return statusOf(saved{}, false)
	}
	var s saved
	if err := json.Unmarshal(b, &s); err != nil {
		// half-written or edited by hand: shown as signed out, and a
		// sign-in writes it whole again
		log.Printf("stallionx: %s is unreadable: %v", accountFile(), err)
		return statusOf(saved{}, false)
	}
	p, err := provider.Find(ProviderID)
	on := err == nil && p.ID == ProviderID && s.Service == Base() && s.KeyHash != "" && s.KeyHash == keyHash(p.Key)
	return statusOf(s, on)
}

// statusOf is the page's view of s.
func statusOf(s saved, on bool) Status {
	base := Base()
	st := Status{SignedIn: on, Service: firstOf(s.Service, base), ProviderID: ProviderID}
	if on {
		st.Email, st.Username, st.Balance = s.Email, s.Username, s.Balance
	}
	site := strings.TrimRight(st.Service, "/")
	st.Terms, st.Privacy = site+"/terms", site+"/privacy"
	return st
}

// balanceOf reads the provision's balance, a JSON number or a decimal
// string, as a plain decimal string ("" when absent).
func balanceOf(raw json.RawMessage) string {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if s == "null" {
		return ""
	}
	return s
}

// firstOf is the first of vs that isn't blank.
func firstOf(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// keyHash binds the displayed account to its current credential without storing
// another copy of the API key. Editing a provider cannot falsely keep a login.
func keyHash(key string) string { sum := sha256.Sum256([]byte(key)); return hex.EncodeToString(sum[:]) }
