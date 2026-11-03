package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
)

// The confirmation of what would delete or clear something (spec § 6.13). A
// risky call writes nothing: it answers what would be lost, with a token. The
// second call, with the same arguments and that token, reads everything again
// and writes once, if the token was given for this account, this MCP token,
// this tool, these arguments and what is there now.

const (
	confirmTTL      = 10 * time.Minute
	confirmPerToken = 20   // waiting confirmations per MCP token; the oldest goes beyond
	confirmTotal    = 1000 // in all
)

// The refusals of a token that does not fit (take).
const (
	refusalUnknown = "unknown" // no such token: never given, dropped, or lost by a restart
	refusalUsed    = "used"    // presented already
	refusalExpired = "expired" // older than confirmTTL
	refusalOther   = "other"   // another account, MCP token, tool or arguments
	refusalChanged = "changed" // what was shown is not what is there now
)

// confirmations keeps the confirmations waiting for their second call, in memory, like
// passkeys.Sessions: one instance runs, a confirmation lives 10 minutes, and one that a
// restart loses is only asked again.
type confirmations struct {
	now     func() time.Time
	mu      sync.Mutex
	entries map[string]pendingConfirmation
	spent   map[string]time.Time // spent tokens, until they would have expired: "already used"
	// made counts the confirmations, to tell the oldest of two made at the same
	// moment.
	made uint64
}

// pendingConfirmation is what a token was given for.
type pendingConfirmation struct {
	userID, tokenID, tool string
	args, state           string // hex SHA-256 of the normalized arguments, and of the state shown
	made, expires         time.Time
	order                 uint64
	// shown are the lines that the confirmation showed (its details): a token
	// refused because the state changed says which lines are new, and which are
	// not true any more.
	shown []string
}

// newConfirmations is the store of the app: Register gives it
// func() time.Time { return now() }, so that it reads the clock of the package.
func newConfirmations(now func() time.Time) *confirmations {
	return &confirmations{now: now, entries: map[string]pendingConfirmation{}, spent: map[string]time.Time{}}
}

// put keeps p, and returns its token and when it expires. The expired
// confirmations go first; then, beyond confirmPerToken for the MCP token of p or
// confirmTotal in all, the oldest.
func (s *confirmations) put(p pendingConfirmation) (token string, expires time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.sweep(now)

	mine := 0
	for _, e := range s.entries {
		if e.tokenID == p.tokenID {
			mine++
		}
	}
	for ; mine >= confirmPerToken; mine-- {
		s.dropOldest(func(e pendingConfirmation) bool { return e.tokenID == p.tokenID })
	}
	for len(s.entries) >= confirmTotal {
		s.dropOldest(func(pendingConfirmation) bool { return true })
	}

	s.made++
	p.made, p.expires, p.order = now, now.Add(confirmTTL), s.made
	token = "cfm_" + rand.Text()
	s.entries[token] = p
	return token, p.expires
}

// take removes token whatever happens, and returns why it does not fit p ("" when it does):
// "unknown", "used", "expired", "other" (another user, MCP token, tool or arguments),
// "changed" (state).
func (s *confirmations) take(token string, p pendingConfirmation) (refusal string) {
	refusal, _ = s.takeShown(token, p)
	return refusal
}

// takeShown is take, and the lines that the confirmation of token showed, when
// it is refused because the state changed.
func (s *confirmations) takeShown(token string, p pendingConfirmation) (refusal string, shown []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.sweepSpent(now)

	e, ok := s.entries[token]
	if !ok {
		if _, used := s.spent[token]; used {
			return refusalUsed, nil
		}
		return refusalUnknown, nil
	}
	delete(s.entries, token)
	s.spend(token, e.expires)

	switch {
	case !now.Before(e.expires):
		return refusalExpired, nil
	case e.userID != p.userID || e.tokenID != p.tokenID || e.tool != p.tool || e.args != p.args:
		return refusalOther, nil
	case e.state != p.state:
		return refusalChanged, e.shown
	}
	return "", nil
}

// sweep drops the confirmations that expired, and the spent tokens that would
// have.
func (s *confirmations) sweep(now time.Time) {
	for token, e := range s.entries {
		if !now.Before(e.expires) {
			delete(s.entries, token)
		}
	}
	s.sweepSpent(now)
}

func (s *confirmations) sweepSpent(now time.Time) {
	for token, expires := range s.spent {
		if !now.Before(expires) {
			delete(s.spent, token)
		}
	}
}

// spend notes a token that was presented, until it would have expired. The
// spent tokens are as many as the confirmations taken in ten minutes, which the
// limit of the MCP tokens bounds: they are bounded here too, the oldest going.
func (s *confirmations) spend(token string, expires time.Time) {
	for len(s.spent) >= confirmTotal {
		oldest, first := "", time.Time{}
		for t, e := range s.spent {
			if oldest == "" || e.Before(first) {
				oldest, first = t, e
			}
		}
		delete(s.spent, oldest)
	}
	s.spent[token] = expires
}

// dropOldest drops the oldest of the confirmations that match.
func (s *confirmations) dropOldest(match func(pendingConfirmation) bool) {
	oldest := ""
	var first pendingConfirmation
	for token, e := range s.entries {
		if match(e) && (oldest == "" || e.order < first.order) {
			oldest, first = token, e
		}
	}
	if oldest != "" {
		delete(s.entries, oldest)
	}
}

// ---------------------------------------------------------------------------
// guard

// stamp is a record that a risk was read from: a change of it changes the
// state that a confirmation was given for.
type stamp struct {
	Collection string `json:"collection"`
	ID         string `json:"id"`
	Updated    string `json:"updated"`
}

// risk is what a call would destroy or overwrite: the French message and lines shown, and
// the records they were read from (collection, id, updated), which make the state hash.
type risk struct {
	Message string
	Details []string
	Records []stamp
}

// confirmationOut is the "confirmation" of a write tool's answer when done is false.
type confirmationOut struct {
	Token     string   `json:"token" jsonschema:"le jeton de confirmation : à redonner tel quel dans confirmation, avec les mêmes arguments, si la personne accepte"`
	ExpiresAt string   `json:"expires_at" jsonschema:"jusqu'à quand le jeton vaut, en UTC"`
	Message   string   `json:"message" jsonschema:"ce qui serait perdu ou changé, en français, à montrer à la personne avant de lui demander son accord"`
	Details   []string `json:"details" jsonschema:"une ligne par élément perdu ou touché"`
}

// The words of a refused token (spec § 6.13).
var refusalNotices = map[string]string{
	refusalExpired: "Confirmation refusée : elle a expiré.",
	refusalUsed:    "Confirmation refusée : elle a déjà servi.",
	refusalOther:   "Confirmation refusée : elle ne correspond pas à cette demande.",
	refusalUnknown: "Confirmation refusée : elle est inconnue (le site a peut-être redémarré).",
	refusalChanged: "Confirmation refusée : la situation a changé depuis.",
}

// noLongerNeeded is what a token is answered with when the call has nothing to
// confirm any more.
const noLongerNeeded = "Cette demande n'a plus besoin de confirmation : rappelle-la sans confirmation."

// What the request log says of a call that asked for a confirmation, or that
// was given one that fits.
const (
	confirmationAsked     = "asked"
	confirmationConfirmed = "confirmed"
)

// guard is what every write tool calls once it has read what it needs, before any write
// (Global Constraints, « The pattern of a write tool »).
//
// Without a token: a call without risk proceeds; a risky one is answered a
// confirmation, and writes nothing. With a token: it is taken, whatever happens
// (a token is good once); one that fits proceeds, one that does not writes
// nothing and says why (notice), with a new confirmation when there is still a
// risk. args are the normalized arguments, without the confirmation.
func (t *tools) guard(ctx context.Context, tool string, args any, r *risk, given string) (proceed bool, out *confirmationOut, notice string, err error) {
	c, err := callerOf(ctx)
	if err != nil {
		return false, nil, "", err
	}
	if c.token == nil || t.confirms == nil {
		return false, nil, "", errors.New("mcp: a write without an MCP token or a store of confirmations")
	}
	argsHash, err := hashOf(args)
	if err != nil {
		return false, nil, "", err
	}
	stateHash, err := stateOf(r)
	if err != nil {
		return false, nil, "", err
	}
	p := pendingConfirmation{userID: c.user.Id, tokenID: c.token.Id, tool: tool, args: argsHash, state: stateHash}

	if given != "" {
		refusal, shown := t.confirms.takeShown(given, p)
		switch {
		case refusal == "":
			c.noteConfirmation(confirmationConfirmed)
			return true, nil, "", nil
		case r == nil:
			return false, nil, noLongerNeeded, nil
		}
		notice = refusalNotices[refusal]
		if refusal == refusalChanged {
			notice += changesOf(shown, r.Details)
		}
	} else if r == nil {
		return true, nil, "", nil
	}

	p.shown = slices.Clone(r.Details)
	token, expires := t.confirms.put(p)
	c.noteConfirmation(confirmationAsked)
	return false, &confirmationOut{
		Token:     token,
		ExpiresAt: expires.UTC().Format(time.RFC3339),
		Message: "Rien n'a été fait. " + r.Message + " Demande son accord à la personne ; si elle accepte, rappelle " + tool +
			" avec les mêmes arguments et confirmation: \"" + token + "\" (valable 10 minutes, une seule fois).",
		Details: orEmpty(r.Details),
	}, notice, nil
}

// changesOf says what changed between the lines that a confirmation showed and
// the ones it would show now: the new lines, and the lines that are not true
// any more. Nothing when no line changed (a record read for them did).
func changesOf(before, after []string) string {
	quoted := func(lines []string, keep func(string) bool) []string {
		var out []string
		for _, line := range lines {
			if keep(line) {
				out = append(out, "« "+strings.TrimSuffix(line, ".")+" »")
			}
		}
		return out
	}
	text := ""
	if added := quoted(after, func(line string) bool { return !slices.Contains(before, line) }); len(added) > 0 {
		text += " Nouveau : " + strings.Join(added, ", ") + "."
	}
	if gone := quoted(before, func(line string) bool { return !slices.Contains(after, line) }); len(gone) > 0 {
		text += " Plus d'actualité : " + strings.Join(gone, ", ") + "."
	}
	return text
}

// hashOf is the hex SHA-256 of the JSON of v: the canonical form of the
// normalized arguments (the fields of a struct in their order, the keys of a map
// sorted).
func hashOf(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("mcp: hashing the arguments of a call: %w", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// stateOf is the hash of what a risk shows and of the records it was read from.
// No risk has a state of its own, which no confirmation was given for.
func stateOf(r *risk) (string, error) {
	if r == nil {
		return hashOf("no risk")
	}
	return hashOf(r)
}

// notDone is the summary of a call that wrote nothing: why, and what to do.
func notDone(out *confirmationOut, notice string) string {
	switch {
	case out == nil:
		return notice
	case notice == "":
		return "Rien n'a été fait : la demande attend l'accord de la personne (voir confirmation)."
	}
	return notice + " Rien n'a été fait : voici une nouvelle confirmation, qui décrit la situation d'aujourd'hui."
}
