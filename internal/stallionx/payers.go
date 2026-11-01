package stallionx

// Payers: who pays for this computer's requests.
//
// A StallionX account pays from its personal wallet, and from the wallet of
// each team it belongs to. Each payer is its own provider here, with its own
// key, so an agent's model id ("provider/model") says who pays for it:
//
//   - personal: the provider ProviderID ("stallionx"), set up by the sign-in;
//   - a team:   the provider "stallionx-team-<hex>" (teamProviderID), set up only when
//     the user enables that team on this computer (EnablePayer). The key is
//     a team key the team's admins can see, disable or delete.
//
// Payers never stand in for each other: a team provider is in no group
// magpie finds on its own (provider.StallionXTeamPayer), so a request never
// fails over from one wallet to another. When a team key stops working (an
// admin disabled it, the user left the team, the team was disabled) the
// provider is left as it is and the payer's state says why; the user picks
// another payer, nothing switches on its own.

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/yetone/magpie/internal/brand"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
)

// PersonalPayer is the id of the personal wallet in Payer.ID and in the
// routes; a team's id is its public id ("team_…").
const PersonalPayer = "personal"

// teamIDRe is the shape of a team's public id: "team_" and the lowercase
// hex of a UUID, as the service makes it (model/team_identity.go). It
// guards the provider id built from it as much as the request.
var teamIDRe = regexp.MustCompile(`^team_[a-z0-9]{1,64}$`)

// Payer states. "" in teamSaved.State is the same as stateReady.
const (
	stateReady          = "ready"           // usable
	stateNotEnabled     = "not_enabled"     // a team not set up on this computer
	stateKeyDisabled    = "key_disabled"    // the team key was disabled (often by a team admin)
	stateKeyMissing     = "key_missing"     // the team key was deleted on the service
	stateNotTeamMember  = "not_team_member" // the user left the team, or it is gone
	stateTeamDisabled   = "team_disabled"   // the team was disabled by the site
	stateTeamDisbanded  = "team_disbanded"  // the team was disbanded
	stateConflict       = "conflict"        // its provider here was edited by hand
	stateSetupFailed    = "setup_failed"    // anything else; Message says what
	reasonKeyNotFound   = "key_not_found"
	reasonTeamKeyOff    = "team_key_disabled"
	reasonNotTeamMember = "not_team_member"
	reasonTeamDisabled  = "team_disabled"
	reasonTeamDisbanded = "team_disbanded"
)

// teamSaved is one team payer enabled on this computer, in account.json.
// Never a secret: the key is in providers.json, bound here by its hash.
type teamSaved struct {
	// Name is the team's name when it was last synced; the provider's
	// name follows it.
	Name string `json:"name"`
	// KeyHash is keyHash of the key saved in the team's provider.
	KeyHash string `json:"keyHash"`
	// TokenID is the key's id on the service, so the console can tell the
	// desktop's team key apart (its list may not carry the plaintext key).
	TokenID string `json:"tokenId,omitempty"`
	// ModelCount is how many models the key listed at the last sync.
	ModelCount int `json:"modelCount,omitempty"`
	// State and Message: why the payer isn't usable, "" when it is.
	State   string `json:"state,omitempty"`
	Message string `json:"message,omitempty"`
}

// Payer is one wallet as the account page shows it.
type Payer struct {
	// ID is PersonalPayer or the team's public id.
	ID string `json:"id"`
	// Kind is "personal" or "team".
	Kind string `json:"kind"`
	// Name is the team's name; empty for the personal wallet (the page
	// names it in the user's language).
	Name string `json:"name,omitempty"`
	// Role is the user's role in the team (1 owner, 2 admin, 3 member, as
	// the service numbers them); 0 for the personal wallet.
	Role int `json:"role,omitempty"`
	// ProviderID is the provider the payer's key is saved as.
	ProviderID string `json:"providerId"`
	// Enabled: the payer's provider is here with this account's key.
	Enabled bool `json:"enabled"`
	// State is one of the state* values; Message says more when there is more.
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
	// Default: the payer the user chose as the default.
	Default bool `json:"default"`
	// Wallet is what the service says is left: the team's balance for its
	// owner and admins, the user's own quota (member_quota) for a member.
	Wallet json.RawMessage `json:"wallet,omitempty"`
}

// PayerList is GET /api/stallionx/payers.
type PayerList struct {
	Payers []Payer `json:"payers"`
	// Ask: the user belongs to a team and hasn't said which payer is the
	// default yet, so the page asks once.
	Ask bool `json:"ask"`
}

// teamProviderID is the provider a team payer's key is saved as:
// "stallionx-team-<hex>", since a provider id takes no underscore.
// provider.StallionXTeamPayer knows a team payer by that prefix.
func teamProviderID(teamID string) string {
	return ProviderID + "-" + strings.Replace(teamID, "_", "-", 1)
}

// teamItem is the part of a GET /api/team/mine item (and a team provision's
// "team") read here.
type teamItem struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Role        int             `json:"role"`
	Status      int             `json:"status"`
	Balance     json.RawMessage `json:"balance"`
	MemberQuota json.RawMessage `json:"member_quota"`
}

// wallet is what is left to spend, as the page shows it.
func (t teamItem) wallet() json.RawMessage {
	if len(t.MemberQuota) > 0 && string(t.MemberQuota) != "null" {
		return t.MemberQuota
	}
	if len(t.Balance) > 0 && string(t.Balance) != "null" {
		b, err := json.Marshal(map[string]json.RawMessage{"balance": t.Balance})
		if err != nil {
			log.Printf("stallionx: encoding a team's balance: %v", err)
			return nil
		}
		return b
	}
	return nil
}

// Team statuses as the service numbers them.
const (
	teamStatusDisabled  = 2
	teamStatusDisbanded = 3
)

// myTeams reads the teams the account belongs to.
func myTeams(ctx context.Context) ([]teamItem, error) {
	raw, err := accountRequest(ctx, http.MethodGet, "/api/team/mine", nil)
	if err != nil {
		return nil, err
	}
	var teams []teamItem
	if err := json.Unmarshal(raw, &teams); err != nil {
		log.Printf("stallionx: decoding the account's teams: %v", err)
		return nil, err
	}
	return teams, nil
}

// ListPayers is the personal wallet and every team the account belongs to,
// with what each can do on this computer.
func ListPayers(ctx context.Context) (PayerList, error) {
	s, err := readAccount()
	if err != nil {
		return PayerList{}, err
	}
	teams, err := myTeams(ctx)
	if err != nil {
		return PayerList{}, err
	}
	personal := Payer{ID: PersonalPayer, Kind: "personal", ProviderID: ProviderID, Enabled: connected(s), State: stateReady, Default: s.DefaultPayer == ""}
	if !setupReady(s) {
		personal.State, personal.Message = stateSetupFailed, s.SetupMessage
	}
	out := PayerList{Payers: []Payer{personal}, Ask: !s.PayerAsked && len(teams) > 0}
	seen := map[string]bool{}
	for _, t := range teams {
		if !teamIDRe.MatchString(t.ID) {
			continue
		}
		seen[t.ID] = true
		saved, enabled := s.Teams[t.ID]
		p := Payer{ID: t.ID, Kind: "team", Name: t.Name, Role: t.Role, ProviderID: teamProviderID(t.ID), Default: s.DefaultPayer == t.ID, Wallet: t.wallet()}
		p.Enabled = enabled && teamConnected(s, t.ID)
		p.State, p.Message = stateNotEnabled, ""
		if enabled {
			p.State, p.Message = firstOf(saved.State, stateReady), saved.Message
		}
		// the team's own status says more than a key's, and is fresh
		switch t.Status {
		case teamStatusDisabled:
			p.State = stateTeamDisabled
		case teamStatusDisbanded:
			p.State = stateTeamDisbanded
		}
		out.Payers = append(out.Payers, p)
	}
	// a team enabled here that the account no longer belongs to: shown so
	// the agents still set to it can be moved, never removed on its own
	for id, saved := range s.Teams {
		if seen[id] {
			continue
		}
		out.Payers = append(out.Payers, Payer{ID: id, Kind: "team", Name: saved.Name, ProviderID: teamProviderID(id), Enabled: teamConnected(s, id), State: stateNotTeamMember, Default: s.DefaultPayer == id})
	}
	return out, nil
}

// teamConnected says the team's provider is here with the key this account
// saved for it, at this service.
func teamConnected(s saved, teamID string) bool {
	t, ok := s.Teams[teamID]
	if !ok || t.KeyHash == "" {
		return false
	}
	p, err := provider.Find(teamProviderID(teamID))
	return err == nil && p.ID == teamProviderID(teamID) && p.Preset == ProviderID && len(p.Keys) == 0 && keyHash(p.Key) == t.KeyHash && p.Chat == s.Service+"/v1"
}

// teamReady says some enabled team payer can serve requests: connected,
// usable at its last sync, and with models in the catalog.
func teamReady(s saved) bool {
	for id, t := range s.Teams {
		if firstOf(t.State, stateReady) != stateReady || t.ModelCount == 0 || !teamConnected(s, id) {
			continue
		}
		if models, _, ok := catalog.Live(teamProviderID(id)); ok && len(models) > 0 {
			return true
		}
	}
	return false
}

// teamProvision is the part of a team provision's answer read here.
type teamProvision struct {
	Key     string          `json:"key"`
	TokenID json.RawMessage `json:"token_id"`
	Team    teamItem        `json:"team"`
}

// EnablePayer sets team teamID up on this computer: it asks the service for
// the account's key in that team (creating one on the team's default group
// the first time; the team's admins can see it), saves it as the team's
// provider and reads its models. It is the one place a team key is created.
func EnablePayer(ctx context.Context, teamID string) (PayerList, error) {
	if !teamIDRe.MatchString(teamID) {
		return PayerList{}, errors.New("not a team id")
	}
	setupMu.Lock()
	err := enableTeam(ctx, teamID, false)
	setupMu.Unlock()
	if err != nil {
		return PayerList{}, err
	}
	invalidateAccess()
	return ListPayers(ctx)
}

// enableTeam provisions team teamID's key and saves it. reuseOnly is the
// background sync's: it never creates a key, and records why a team payer
// stopped working instead of failing. The caller holds setupMu.
func enableTeam(ctx context.Context, teamID string, reuseOnly bool) error {
	s, err := readAccount()
	if err != nil {
		return err
	}
	body := map[string]any{"name": tokenName, "team_id": teamID}
	if reuseOnly {
		body["reuse_only"] = true
	}
	raw, err := accountRequest(ctx, http.MethodPost, "/api/cli/provision", body)
	if err != nil {
		var se *serviceError
		if reuseOnly && errors.As(err, &se) && se.reason != "" {
			return recordTeam(s, teamID, func(t *teamSaved) { t.State, t.Message = stateOfReason(se.reason), se.message })
		}
		return err
	}
	var prov teamProvision
	if err := json.Unmarshal(raw, &prov); err != nil {
		log.Printf("stallionx: decoding team %s's key: %v", teamID, err)
		return err
	}
	if prov.Key == "" {
		return errors.New("StallionX returned no key for this team")
	}
	name := firstOf(prov.Team.Name, s.Teams[teamID].Name, teamID)
	mu.Lock()
	now, err := readAccount()
	if err != nil || now.At != s.At || now.Email != s.Email || now.Service != s.Service {
		mu.Unlock()
		if err == nil {
			err = errors.New("the StallionX account changed while setting up the team")
		}
		return err
	}
	previous := now.Teams[teamID]
	if err := saveTeamProvider(now, teamID, name, prov.Key, previous.KeyHash); err != nil {
		mu.Unlock()
		if reuseOnly && errors.Is(err, errCustomTeamProvider) {
			return recordTeam(s, teamID, func(t *teamSaved) { t.Name, t.State, t.Message = name, stateConflict, err.Error() })
		}
		return err
	}
	if now.Teams == nil {
		now.Teams = map[string]teamSaved{}
	}
	now.Teams[teamID] = teamSaved{Name: name, KeyHash: keyHash(prov.Key), TokenID: strings.Trim(string(prov.TokenID), `"`), State: stateSetupFailed, Message: "Model list synchronization is incomplete"}
	err = writeAccount(now)
	mu.Unlock()
	if err != nil {
		return err
	}
	p, err := provider.Find(teamProviderID(teamID))
	if err != nil {
		return err
	}
	models, err := p.Fetch(ctx)
	if err == nil && len(models) == 0 {
		err = errors.New("StallionX returned no available models for this team")
	}
	return recordTeam(s, teamID, func(t *teamSaved) {
		t.State, t.Message, t.ModelCount = "", "", len(models)
		if err != nil {
			t.State, t.Message, t.ModelCount = stateSetupFailed, err.Error(), 0
		}
	})
}

// recordTeam changes team teamID's saved entry, when the account is still
// the one s read.
func recordTeam(s saved, teamID string, change func(*teamSaved)) error {
	mu.Lock()
	defer mu.Unlock()
	now, err := readAccount()
	if err != nil {
		return err
	}
	if now.At != s.At || now.Email != s.Email || now.Service != s.Service {
		return nil // another sign-in owns account.json now
	}
	t, ok := now.Teams[teamID]
	if !ok {
		return nil // removed from this computer meanwhile: not brought back
	}
	change(&t)
	now.Teams[teamID] = t
	return writeAccount(now)
}

// stateOfReason is the payer state for a provision's data.reason.
func stateOfReason(reason string) string {
	switch reason {
	case reasonKeyNotFound:
		return stateKeyMissing
	case reasonTeamKeyOff:
		return stateKeyDisabled
	case reasonNotTeamMember:
		return stateNotTeamMember
	case reasonTeamDisabled:
		return stateTeamDisabled
	case reasonTeamDisbanded:
		return stateTeamDisbanded
	}
	return stateSetupFailed
}

// syncTeams refreshes every team payer enabled here without creating a key
// (reuse_only): the key, the team's name, and why one stopped working. A
// team's failure never fails the account's setup. The caller holds setupMu.
func syncTeams(ctx context.Context) {
	s, err := readAccount()
	if err != nil {
		return
	}
	for id := range s.Teams {
		if !teamIDRe.MatchString(id) {
			continue
		}
		if err := enableTeam(ctx, id, true); err != nil {
			log.Printf("stallionx: syncing team %s: %v", id, err)
			if e := recordTeam(s, id, func(t *teamSaved) { t.State, t.Message = stateSetupFailed, err.Error() }); e != nil {
				log.Printf("stallionx: recording team %s's sync: %v", id, e)
			}
		}
	}
}

// errCustomTeamProvider: a team's provider here holds credentials this
// account didn't save (edited by hand); it is never overwritten.
var errCustomTeamProvider = errors.New("this team's provider was edited on this computer; rename it to set the team up again")

// saveTeamProvider saves key as team teamID's provider, keeping what the
// user set on it (model picks, routing) and replacing its endpoints, key and
// name, which the sign-in owns. The caller holds mu.
func saveTeamProvider(s saved, teamID, teamName, key, previousHash string) error {
	id := teamProviderID(teamID)
	p, err := provider.FromPreset(ProviderID)
	if err != nil {
		log.Printf("stallionx: the %s preset: %v", ProviderID, err)
		return err
	}
	if err := provider.FileError(); err != nil {
		return err
	}
	if o, err := provider.Find(id); err == nil && o.ID == id {
		if o.Preset != ProviderID || len(o.Keys) != 0 || previousHash == "" || keyHash(o.Key) != previousHash {
			return errCustomTeamProvider
		}
		p = *o
	}
	p.ID, p.Preset, p.Icon = id, ProviderID, ProviderID
	// the team's name tells this payer's models apart from the personal
	// wallet's wherever a model is picked
	p.Name = brand.Name + " · " + teamName
	p.Chat, p.Responses, p.Anthropic = s.Service+"/v1", s.Service+"/v1", s.Service
	p.Website, p.KeysURL = s.Service, s.Service+"/personal/token"
	p.Key, p.Keys = key, nil
	p.BalanceURL = s.Service + "/api/usage/token"
	if err := provider.Save(p); err != nil {
		return err
	}
	provider.ForgetBalances()
	return nil
}

// RemovePayer takes team teamID's provider off this computer. The key stays
// on the service, where enabling the team again finds it. The default goes
// back to the personal wallet when it was this team.
func RemovePayer(ctx context.Context, teamID string) (PayerList, error) {
	if !teamIDRe.MatchString(teamID) {
		return PayerList{}, errors.New("not a team id")
	}
	setupMu.Lock()
	mu.Lock()
	s, err := readAccount()
	if err == nil {
		removeTeamProvider(s, teamID)
		delete(s.Teams, teamID)
		if s.DefaultPayer == teamID {
			s.DefaultPayer = ""
		}
		err = writeAccount(s)
	}
	mu.Unlock()
	setupMu.Unlock()
	if err != nil {
		return PayerList{}, err
	}
	invalidateAccess()
	return ListPayers(ctx)
}

// SetDefaultPayer records id (PersonalPayer or a team's public id) as the
// default payer and that the user has answered. A team not set up here yet
// is enabled first: choosing it is the user's click. The default payer's
// provider is put first on the Providers page and in model pickers.
func SetDefaultPayer(ctx context.Context, id string) (PayerList, error) {
	team := ""
	if id != PersonalPayer && id != "" {
		if !teamIDRe.MatchString(id) {
			return PayerList{}, errors.New("not a team id")
		}
		team = id
	}
	setupMu.Lock()
	var err error
	if s, e := readAccount(); e != nil {
		err = e
	} else if _, on := s.Teams[team]; team != "" && (!on || !teamConnected(s, team)) {
		err = enableTeam(ctx, team, false)
	}
	if err == nil {
		mu.Lock()
		var s saved
		if s, err = readAccount(); err == nil {
			s.DefaultPayer, s.PayerAsked = team, true
			err = writeAccount(s)
		}
		mu.Unlock()
	}
	setupMu.Unlock()
	if err != nil {
		return PayerList{}, err
	}
	putFirst(ProviderID, team)
	invalidateAccess()
	return ListPayers(ctx)
}

// putFirst moves the default payer's provider to the front of the order
// the user arranges providers in, the rest keeping theirs.
func putFirst(personal, team string) {
	first := personal
	if team != "" {
		first = teamProviderID(team)
	}
	order, err := provider.StoredOrder()
	if err != nil {
		log.Printf("stallionx: reading the provider order: %v", err)
		return
	}
	next := []string{first}
	for _, id := range order {
		if id != first {
			next = append(next, id)
		}
	}
	if err := provider.SetOrder(next); err != nil {
		log.Printf("stallionx: putting the default payer first: %v", err)
	}
}

// removeTeamProviders takes every team payer of s off this computer, the
// ones edited by hand excepted. The caller holds mu.
func removeTeamProviders(s saved) {
	for id := range s.Teams {
		removeTeamProvider(s, id)
	}
}

// removeTeamProvider deletes team teamID's provider when it still holds the
// key this account saved; one edited by hand isn't ours and stays.
func removeTeamProvider(s saved, teamID string) {
	t, ok := s.Teams[teamID]
	if !ok || t.KeyHash == "" {
		return
	}
	id := teamProviderID(teamID)
	p, err := provider.Find(id)
	if err != nil || p.ID != id || p.Preset != ProviderID || len(p.Keys) != 0 || keyHash(p.Key) != t.KeyHash {
		return
	}
	if err := provider.Delete(id); err != nil {
		log.Printf("stallionx: removing team %s's provider: %v", teamID, err)
	}
}

// desktopTeamKey says key (a service token as the console reads it) is a
// team key this computer's payers use: the console must not let it be
// edited or deleted there, as with the personal desktop key.
func desktopTeamKey(s saved, key map[string]json.RawMessage) bool {
	id, plain := rawString(key["id"]), rawString(key["key"])
	for _, t := range s.Teams {
		if t.TokenID != "" && t.TokenID == id {
			return true
		}
		if plain != "" && t.KeyHash != "" && keyHash(plain) == t.KeyHash {
			return true
		}
	}
	return false
}
