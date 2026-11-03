package mcp

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/wording"
)

// This file has requireAdmin, with which every admin tool starts, and the tools of
// the members page of the admin (spec § 6.11): admin_list_members,
// admin_create_runner, admin_delete_runner, admin_set_role and admin_set_disabled.
// Each sends the requests of the page (web/src/features/admin/api.ts), as the
// caller: the rules of the collections, the routes and the hooks of the site decide
// (the last admin, a runner with an account or with participations), and a tool
// only announces the refusal that it knows the site will give.
//
// No admin tool reads an email (spec § 6.11): the requests that read an account
// ask for its role and whether it is turned off, and nothing else (fields=), and
// an account is only ever named by its runner.

// requireAdmin starts every admin tool: for a caller who is not an admin it returns
// the error that the SDK gives for a tool it does not have (v1.8.0, server.go),
// word for word, so that a wiring mistake that put an admin tool on the member
// server still opens nothing. The role is the one of the account of the request
// (roleOf), whichever server serves it.
//
// The error is returned as it is, never wrapped: the SDK recognises a
// *jsonrpc.Error by a type assertion, and a wrapped one would become a tool error
// (isError) instead.
func requireAdmin(ctx context.Context, tool string) error {
	if c, err := callerOf(ctx); err == nil && c.user != nil && roleOf(c.user) == roleAdmin {
		return nil
	}
	return &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: fmt.Sprintf("unknown tool %q", tool)}
}

// adminWrite is the handler of an admin tool that takes a confirmation: the role
// first (requireAdmin), then the tool through usesUpConfirmation. The call of
// somebody who is not an admin, which only a wiring mistake would let through, is
// answered as a tool that does not exist, and leaves the token that it presents
// as it was, as the SDK leaves it for a tool that it does not have.
func adminWrite[In confirmable, Out any](t *tools, tool string, handler mcpsdk.ToolHandlerFor[In, Out]) mcpsdk.ToolHandlerFor[In, Out] {
	written := usesUpConfirmation(t, handler)
	return func(ctx context.Context, req *mcpsdk.CallToolRequest, in In) (*mcpsdk.CallToolResult, Out, error) {
		if err := requireAdmin(ctx, tool); err != nil {
			var none Out
			return nil, none, err
		}
		return written(ctx, req, in)
	}
}

// ---------------------------------------------------------------------------
// What the admin tools read

// accountRecord is an account as the admin tools read it, from its runner: its
// role and whether it is turned off. Never its email: the requests ask for these
// fields only (memberFields, accountFields).
type accountRecord struct {
	ID       string `json:"id"`
	Role     string `json:"role"`
	Disabled bool   `json:"disabled"`
	Updated  string `json:"updated"`
}

// accountFields are the fields that an update of an account asks back.
const accountFields = "id,role,disabled,updated"

// memberRunner is a runner with its account, as the members page reads it
// (expand=user): no account when it has none.
type memberRunner struct {
	runnerRecord
	Expand struct {
		User *accountRecord `json:"user"`
	} `json:"expand"`
}

// memberFields are the fields that the admin tools ask of a runner and its account.
// The rule of the accounts shows an admin their email: it is not asked for.
const memberFields = "id,name,user,avatar,updated,expand.user.id,expand.user.role,expand.user.disabled,expand.user.updated"

// account is the account of the runner; nil when it has none (or when the API did
// not send it, which counts as none, as on the page).
func (m memberRunner) account() *accountRecord {
	if m.User == "" || m.Expand.User == nil || m.Expand.User.ID == "" {
		return nil
	}
	return m.Expand.User
}

// memberRunners are the runners of the group with their account.
func (t *tools) memberRunners(ctx context.Context) ([]memberRunner, error) {
	return listAll[memberRunner](ctx, t.inner, "runners", url.Values{"sort": {"name"}, "expand": {"user"}, "fields": {memberFields}}, 500)
}

// invitationRecord is a link of the admin (an invitation or a reset), as the tools
// read it: never its token, which the site does not keep, nor the hash that it
// keeps (the requests ask for these fields only).
type invitationRecord struct {
	ID        string `json:"id"`
	Runner    string `json:"runner"`
	Kind      string `json:"kind"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expires_at"`
	UsedAt    string `json:"used_at"`
	Updated   string `json:"updated"`
}

// invitationFields are the fields that the tools ask of a link.
const invitationFields = "id,runner,kind,role,expires_at,used_at,updated"

// The kinds of a link (invitations.Kind).
const (
	linkInvite = "invite"
	linkReset  = "reset"
)

// The roles of an account.
const (
	accountMember = "member"
	accountAdmin  = "admin"
)

// runnerNamed is the runner that an admin tool is given, by its id or its name: an
// admin tool acts on somebody, and has no runner by default.
func runnerNamed(all []runnerRecord, input string) (runnerRecord, error) {
	if strings.TrimSpace(input) == "" {
		return runnerRecord{}, errors.New("Il manque le coureur (runner) : son nom ou son identifiant (admin_list_members les donne).")
	}
	return resolveRunner(all, input, "")
}

// memberNamed is runnerNamed, among the runners with their account.
func memberNamed(all []memberRunner, input string) (memberRunner, error) {
	runners := make([]runnerRecord, len(all))
	for i, m := range all {
		runners[i] = m.runnerRecord
	}
	runner, err := runnerNamed(runners, input)
	if err != nil {
		return memberRunner{}, err
	}
	for _, m := range all {
		if m.ID == runner.ID {
			return m, nil
		}
	}
	return memberRunner{}, errors.New("mcp: a runner that is not among the runners")
}

// countWhere is the number of records of a collection whose field is the record
// id, as the API counts them: one request for one record, with the total. The id
// is the only thing of the filter: one that is not an id is not sent.
func (t *tools) countWhere(ctx context.Context, collection, field, id string) (int, error) {
	if !isID(id) {
		return 0, errors.New("mcp: counting by an id that is not an id")
	}
	var answer struct {
		TotalItems int `json:"totalItems"`
	}
	query := url.Values{"filter": {"(" + field + "='" + id + "')"}, "fields": {"id"}, "perPage": {"1"}, "page": {"1"}}
	if err := t.inner.get(ctx, "/api/collections/"+collection+"/records?"+query.Encode(), &answer); err != nil {
		return 0, err
	}
	return answer.TotalItems, nil
}

// roleWords are the roles as the site names them (fr.admin.roles), in a sentence.
var roleWords = map[string]string{accountMember: "membre", accountAdmin: "admin"}

// adminPowers is what an admin can do that a member cannot: the admin pages.
const adminPowers = "gérer les membres (invitations, liens de réinitialisation, rôles, comptes désactivés), les types de course et les doublons"

// ---------------------------------------------------------------------------
// The state of a runner: a port of web/src/features/admin/memberState.ts.

// The states of a runner (MemberState of the site).
const (
	stateNoAccount = "no_account"
	stateInvited   = "invited"
	stateActive    = "active"
	stateDisabled  = "disabled"
)

// stateLabels are the states as the members page names them (fr.admin).
var stateLabels = map[string]string{
	stateNoAccount: "Sans compte",
	stateInvited:   "Invitation en attente",
	stateActive:    "Actif",
	stateDisabled:  "Désactivé",
}

// instantOf ports instantOf: a date and a time as PocketBase writes it
// (2026-11-07 12:00:00.000Z), or in RFC 3339 (2026-11-07T12:00:00Z, as the route of
// the invitations answers). ok is false for neither.
func instantOf(dateTime string) (at time.Time, ok bool) {
	at, err := time.Parse(time.RFC3339, strings.Replace(dateTime, " ", "T", 1))
	return at, err == nil
}

// expiryDay ports expiryDay: the day, in Paris, that a link expires (the page shows
// the day, not the hour). A date that cannot be read is given as it is written, to
// its day.
func expiryDay(expiresAt string) string {
	at, ok := instantOf(expiresAt)
	if !ok {
		return expiresAt[:min(len(expiresAt), len(time.DateOnly))]
	}
	return at.In(paris).Format(time.DateOnly)
}

// isPending ports isPending: a link that was not used, and that has not expired (it
// expires at its expires_at, which is itself too late). A link whose expiry cannot
// be read is not one.
func isPending(link invitationRecord, now time.Time) bool {
	at, ok := instantOf(link.ExpiresAt)
	return link.UsedAt == "" && ok && at.After(now)
}

// memberState ports memberState: the state of a runner. user is its account, nil
// when it has none; pending the invitation to look at, if there is one (its own,
// which may well be used or expired by now: only one that can still be used
// counts). An account is what a runner is: an invitation left waiting beside it
// does not change that.
func memberState(runner runnerRecord, user *accountRecord, pending *invitationRecord, now time.Time) string {
	switch {
	case user != nil && user.Disabled:
		return stateDisabled
	case user != nil:
		return stateActive
	case pending != nil && pending.Runner == runner.ID && isPending(*pending, now):
		return stateInvited
	}
	return stateNoAccount
}

// member ports Member: a runner of the list, with its account, its state, the
// invitation that waits for a runner who is invited, and the reset that waits for a
// runner who has an account.
type member struct {
	runner            runnerRecord
	user              *accountRecord
	state             string
	invitation, reset *invitationRecord
}

// latestPending ports latestPending: of the links of a kind that wait for a runner,
// the one that is valid the longest; nil for none.
func latestPending(links []invitationRecord, runnerID, kind string, now time.Time) *invitationRecord {
	var latest *invitationRecord
	var latestAt time.Time
	for _, link := range links {
		if link.Runner != runnerID || link.Kind != kind || !isPending(link, now) {
			continue
		}
		if at, _ := instantOf(link.ExpiresAt); latest == nil || at.After(latestAt) {
			found := link
			latest, latestAt = &found, at
		}
	}
	return latest
}

// toMembers ports toMembers: the runners by name, each with its account, its state,
// and the links that wait for it.
func toMembers(runners []memberRunner, links []invitationRecord, now time.Time) []member {
	out := make([]member, 0, len(runners))
	for _, r := range runners {
		user := r.account()
		var invite *invitationRecord
		if user == nil {
			invite = latestPending(links, r.ID, linkInvite, now)
		}
		m := member{runner: r.runnerRecord, user: user, state: memberState(r.runnerRecord, user, invite, now)}
		if m.state == stateInvited {
			m.invitation = invite
		}
		if user != nil {
			m.reset = latestPending(links, r.ID, linkReset, now)
		}
		out = append(out, m)
	}
	slices.SortStableFunc(out, func(a, b member) int {
		return cmp.Or(compareNames(a.runner.Name, b.runner.Name), cmp.Compare(a.runner.ID, b.runner.ID))
	})
	return out
}

// ---------------------------------------------------------------------------
// admin_list_members

type listMembersIn struct {
	Query string `json:"query,omitempty" jsonschema:"ne garde que les coureurs dont le nom contient ce texte, sans tenir compte des majuscules ni des accents"`
}

// pendingLinkOut is a link that waits: never its token, which the site does not
// keep.
type pendingLinkOut struct {
	ID        string `json:"id" jsonschema:"l'identifiant du lien"`
	ExpiresAt string `json:"expires_at" jsonschema:"le jour où il expire, à Paris (AAAA-MM-JJ)"`
	Role      string `json:"role,omitempty" jsonschema:"une invitation : le rôle du compte qu'elle crée, member ou admin"`
}

// memberOut is a runner of the members page (spec § 6.11, MEMBER).
type memberOut struct {
	Runner         runnerRef       `json:"runner"`
	State          string          `json:"state" jsonschema:"no_account (pas de compte ni d'invitation en attente), invited (une invitation attend), active (un compte) ou disabled (un compte désactivé)"`
	StateLabel     string          `json:"state_label" jsonschema:"l'état, comme la page Membres l'écrit"`
	Role           string          `json:"role,omitempty" jsonschema:"le rôle du compte, member ou admin ; absent sans compte"`
	Participations int             `json:"participations" jsonschema:"le nombre de ses participations : un coureur qui en a ne se supprime pas"`
	Passkeys       *int            `json:"passkeys,omitempty" jsonschema:"le nombre de clés d'accès du compte (passkeys, action list, en donne le détail) ; absent sans compte"`
	Invitation     *pendingLinkOut `json:"invitation,omitempty" jsonschema:"l'invitation qui attend, pour un coureur sans compte"`
	Reset          *pendingLinkOut `json:"reset,omitempty" jsonschema:"le lien de réinitialisation qui attend, pour un coureur qui a un compte"`
}

type listMembersOut struct {
	Members []memberOut `json:"members" jsonschema:"les coureurs du groupe, par nom"`
}

func addAdminListMembers(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_list_members",
		Title: "Membres",
		Description: "Admin → Membres : chaque coureur du groupe, par nom, avec son état (sans compte, invitation en attente, actif, désactivé), " +
			"le rôle de son compte, son nombre de participations (un coureur qui en a ne se supprime pas) et de clés d'accès, " +
			"et les liens qui l'attendent (invitation, réinitialisation), avec leur date d'expiration. " +
			"L'outil ne donne jamais d'email ni le jeton d'un lien : un compte se désigne par son coureur.",
		Annotations: readOnly(),
	}, t.adminListMembers)
}

func (t *tools) adminListMembers(ctx context.Context, _ *mcpsdk.CallToolRequest, in listMembersIn) (*mcpsdk.CallToolResult, listMembersOut, error) {
	if err := requireAdmin(ctx, "admin_list_members"); err != nil {
		return nil, listMembersOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, listMembersOut, error) {
		return nil, listMembersOut{}, describe(t.app, err, nil)
	}
	runners, err := t.memberRunners(ctx)
	if err != nil {
		return fail(err)
	}
	links, err := listAll[invitationRecord](ctx, t.inner, "invitations", url.Values{"filter": {"(used_at='')"}, "fields": {invitationFields}, "sort": {"created"}}, 500)
	if err != nil {
		return fail(err)
	}
	query := wording.Fold(in.Query)
	out := listMembersOut{Members: []memberOut{}}
	for _, m := range toMembers(runners, links, now()) {
		if !strings.Contains(wording.Fold(m.runner.Name), query) {
			continue
		}
		// The participations and the passkeys are counted, a request of one record
		// each, with its total: never read, so that years of races do not reach the
		// bound of a read.
		participations, err := t.countWhere(ctx, "participations", "runner", m.runner.ID)
		if err != nil {
			return fail(err)
		}
		member := memberOut{
			Runner: m.runner.ref(), State: m.state, StateLabel: stateLabels[m.state],
			Participations: participations,
		}
		if m.user != nil {
			passkeys, err := t.countWhere(ctx, "passkeys", "user", m.user.ID)
			if err != nil {
				return fail(err)
			}
			member.Role, member.Passkeys = m.user.Role, ptr(passkeys)
		}
		if m.invitation != nil {
			member.Invitation = &pendingLinkOut{ID: m.invitation.ID, ExpiresAt: expiryDay(m.invitation.ExpiresAt), Role: m.invitation.Role}
		}
		if m.reset != nil {
			member.Reset = &pendingLinkOut{ID: m.reset.ID, ExpiresAt: expiryDay(m.reset.ExpiresAt)}
		}
		out.Members = append(out.Members, member)
	}
	return nil, out, nil
}

// ---------------------------------------------------------------------------
// admin_create_runner

type createRunnerIn struct {
	Name string `json:"name" jsonschema:"le nom, de 1 à 50 caractères, unique sans tenir compte de la casse : le site retire les espaces de début et de fin"`
}

type createRunnerOut struct {
	Done    bool      `json:"done" jsonschema:"toujours vrai : ce que le site refuse est une erreur"`
	Runner  runnerOut `json:"runner" jsonschema:"le coureur, comme list_runners le donne"`
	Summary string    `json:"summary" jsonschema:"ce qui a été fait, en une phrase"`
}

func addAdminCreateRunner(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_create_runner",
		Title: "Ajouter un coureur",
		Description: "Membres → « Ajouter un coureur » : un coureur sans compte, que le groupe peut inscrire aux courses. " +
			"Le nom fait de 1 à 50 caractères et reste unique sans tenir compte de la casse : le site refuse un nom pris, avec son message. " +
			"Pour lui créer un compte : admin_create_link (kind: invite), dont la personne ouvre elle-même le lien.",
		InputSchema: inputSchema[createRunnerIn](nil),
		Annotations: writeAnnotations(false, false),
	}, t.adminCreateRunner)
}

func (t *tools) adminCreateRunner(ctx context.Context, _ *mcpsdk.CallToolRequest, in createRunnerIn) (*mcpsdk.CallToolResult, createRunnerOut, error) {
	if err := requireAdmin(ctx, "admin_create_runner"); err != nil {
		return nil, createRunnerOut{}, err
	}
	c, err := callerOf(ctx)
	if err != nil {
		return nil, createRunnerOut{}, describe(t.app, err, nil)
	}
	// The name is sent as the form sends it: without the blanks around it. The site
	// decides what is blank, too long or taken.
	var created runnerRecord
	if err := t.inner.send(ctx, http.MethodPost, "/api/collections/runners/records", map[string]any{"name": strings.TrimSpace(in.Name)}, &created); err != nil {
		return nil, createRunnerOut{}, describe(t.app, err, nil)
	}
	return nil, createRunnerOut{
		Done:    true,
		Runner:  newRunnerOut(t.cfg, created, c.user.Id),
		Summary: fmt.Sprintf("Le coureur %s est ajouté, sans compte. Pour lui en créer un : admin_create_link (kind: invite), dont la personne ouvre elle-même le lien.", quote(created.Name)),
	}, nil
}

// ---------------------------------------------------------------------------
// admin_delete_runner

type deleteRunnerIn struct {
	Runner       string `json:"runner" jsonschema:"l'identifiant ou le nom du coureur (admin_list_members les donne)"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in deleteRunnerIn) confirmationGiven() string { return in.Confirmation }

type deleteRunnerOut struct {
	writeStatus
	Removed *runnerRef `json:"removed,omitempty" jsonschema:"le coureur supprimé"`
}

var deleteRunnerSchema = sync.OnceValue(writeSchema[deleteRunnerOut])

func addAdminDeleteRunner(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_delete_runner",
		Title: "Supprimer un coureur",
		Description: "Membres → « Supprimer » : supprime un coureur qui n'a ni compte ni participation, comme un coureur ajouté par erreur. " +
			"Le site refuse les autres, et l'outil l'annonce sans rien demander : un compte se désactive (admin_set_disabled), des participations se retirent d'abord. " +
			"Il demande toujours une confirmation : le premier appel ne fait rien, et donne un jeton à redonner si la personne accepte.",
		InputSchema:  inputSchema[deleteRunnerIn](nil),
		OutputSchema: deleteRunnerSchema(),
		Annotations:  writeAnnotations(true, false),
	}, adminWrite(t, "admin_delete_runner", t.adminDeleteRunner))
}

func (t *tools) adminDeleteRunner(ctx context.Context, _ *mcpsdk.CallToolRequest, in deleteRunnerIn) (*mcpsdk.CallToolResult, deleteRunnerOut, error) {
	if err := requireAdmin(ctx, "admin_delete_runner"); err != nil {
		return nil, deleteRunnerOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, deleteRunnerOut, error) {
		return nil, deleteRunnerOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, deleteRunnerOut, error) {
		return nil, deleteRunnerOut{}, err
	}
	runners, err := t.runners(ctx)
	if err != nil {
		return fail(err)
	}
	runner, err := runnerNamed(runners, in.Runner)
	if err != nil {
		return refuse(err)
	}
	if !isID(runner.ID) {
		return fail(errors.New("mcp: a runner id that is not an id"))
	}
	// The refusals of the site (the hooks of the runners). The site looks at the
	// participations first, and would say runner_has_participations to a runner
	// who has both; the tool names the account first, because it is the refusal
	// that decides (a runner with an account is never deleted, participations or
	// not: it is turned off), as the members page, which offers no « Supprimer » to
	// a runner with an account.
	if runner.User != "" {
		return refuse(fmt.Errorf("%s a un compte : désactive-le plutôt (admin_set_disabled). (runner_has_account)", plain(runner.Name)))
	}
	n, err := t.countWhere(ctx, "participations", "runner", runner.ID)
	if err != nil {
		return fail(err)
	}
	if n > 0 {
		them := "retire-les"
		if n == 1 {
			them = "retire-la"
		}
		return refuse(fmt.Errorf("%s a %s : %s d'abord. (runner_has_participations)", plain(runner.Name), plural(n, "participation", "participations"), them))
	}

	// The links that wait for the runner go with it (the site deletes them with
	// it).
	waiting, err := t.waitingLinks(ctx, runner.ID)
	if err != nil {
		return fail(err)
	}

	// Always asked: the runner is gone from the group, with its links.
	lines := []string{fmt.Sprintf("Le coureur %s (sans compte, sans participation) sera supprimé : il ne sera plus proposé quand on inscrit quelqu'un à une course.", quote(runner.Name))}
	records := []stamp{{Collection: "runners", ID: runner.ID, Updated: runner.Updated}}
	for _, link := range waiting {
		lines = append(lines, waitingLine(link, runner))
		records = append(records, stamp{Collection: "invitations", ID: link.ID, Updated: link.Updated})
	}
	r := &risk{Message: strings.Join(lines, " "), Details: lines, Records: records}
	proceed, out, notice, err := t.guard(ctx, "admin_delete_runner", struct{ Runner string }{runner.ID}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, deleteRunnerOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	if err := t.inner.send(ctx, http.MethodDelete, "/api/collections/runners/records/"+runner.ID, nil, nil); err != nil {
		return fail(err)
	}
	return nil, deleteRunnerOut{
		writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("Le coureur %s est supprimé.", quote(runner.Name))},
		Removed:     ptr(runner.ref()),
	}, nil
}

// ---------------------------------------------------------------------------
// admin_set_role and admin_set_disabled

// accountNamed is the runner that an admin tool is given, and its account: a runner
// without one is refused with what makes one.
func (t *tools) accountNamed(ctx context.Context, input string) (memberRunner, *accountRecord, error) {
	runners, err := t.memberRunners(ctx)
	if err != nil {
		return memberRunner{}, nil, describe(t.app, err, nil)
	}
	runner, err := memberNamed(runners, input)
	if err != nil {
		return memberRunner{}, nil, err
	}
	account := runner.account()
	if account == nil {
		return memberRunner{}, nil, fmt.Errorf("%s n'a pas de compte. Pour lui en créer un : admin_create_link (kind: invite), dont la personne ouvre elle-même le lien.", plain(runner.Name))
	}
	if !isID(account.ID) {
		return memberRunner{}, nil, describe(t.app, errors.New("mcp: an account id that is not an id"), nil)
	}
	return runner, account, nil
}

// updateAccount sends the update of an account, built from one typed field (the
// route of the accounts is only ever sent {role} or {disabled}), and asks back
// none of its other fields.
func (t *tools) updateAccount(ctx context.Context, id, field string, value any) (accountRecord, error) {
	var updated accountRecord
	path := "/api/collections/users/records/" + id + "?" + url.Values{"fields": {accountFields}}.Encode()
	err := t.inner.send(ctx, http.MethodPatch, path, map[string]any{field: value}, &updated)
	return updated, err
}

type setRoleIn struct {
	Runner       string `json:"runner" jsonschema:"l'identifiant ou le nom du coureur dont le compte change de rôle (admin_list_members les donne)"`
	Role         string `json:"role" jsonschema:"member ou admin"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in setRoleIn) confirmationGiven() string { return in.Confirmation }

type setRoleOut struct {
	writeStatus
	Runner *runnerRef `json:"runner,omitempty" jsonschema:"le coureur du compte"`
	Role   string     `json:"role,omitempty" jsonschema:"le rôle du compte, maintenant"`
}

var setRoleSchema = sync.OnceValue(writeSchema[setRoleOut])

func addAdminSetRole(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_set_role",
		Title: "Changer le rôle",
		Description: "Membres → « Passer admin », « Retirer admin » : donne au compte d'un coureur le rôle member ou admin. " +
			"Un admin a les pages Admin du site (membres, invitations, rôles, types de course, doublons) et ces outils admin_…. " +
			"Le site garde toujours un admin actif : il refuse de retirer son rôle au dernier (last_admin). Retirer son propre rôle est permis s'il en reste un autre : les outils admin_… disparaissent alors de cet assistant dès sa requête suivante. " +
			"Il demande toujours une confirmation : le premier appel ne fait rien, et donne un jeton à redonner si la personne accepte. Un rôle déjà le bon ne change rien.",
		InputSchema:  inputSchema[setRoleIn](map[string][]string{"role": {accountMember, accountAdmin}}),
		OutputSchema: setRoleSchema(),
		Annotations:  writeAnnotations(true, true),
	}, adminWrite(t, "admin_set_role", t.adminSetRole))
}

func (t *tools) adminSetRole(ctx context.Context, _ *mcpsdk.CallToolRequest, in setRoleIn) (*mcpsdk.CallToolResult, setRoleOut, error) {
	if err := requireAdmin(ctx, "admin_set_role"); err != nil {
		return nil, setRoleOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, setRoleOut, error) {
		return nil, setRoleOut{}, describe(t.app, err, nil)
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	role := in.Role
	if _, ok := roleWords[role]; !ok {
		return nil, setRoleOut{}, errors.New("role est member ou admin.")
	}
	runner, account, err := t.accountNamed(ctx, in.Runner)
	if err != nil {
		return nil, setRoleOut{}, err
	}
	own := account.ID == c.user.Id
	who := "Le compte de " + plain(runner.Name)
	if own {
		who = "Ton compte"
	}
	if account.Role == role {
		return nil, setRoleOut{
			writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("Rien à changer : %s est déjà %s.", lowerFirst(who), roleWords[role])},
			Runner:      ptr(runner.ref()), Role: role,
		}, nil
	}

	// Always asked: the rights of an account change.
	lines := []string{fmt.Sprintf("%s passerait %s à %s.", who, ofName(roleWords[account.Role]), roleWords[role])}
	if role == accountAdmin {
		lines = append(lines, "Ce compte pourrait alors "+adminPowers+".",
			"Les assistants qui ont un jeton de ce compte auraient aussi les outils admin_… dès leur requête suivante.")
		if account.Disabled {
			lines = append(lines, "Ce compte est désactivé : ce rôle ne servira qu'une fois le compte réactivé.")
		}
	} else {
		lines = append(lines, "Ce compte ne pourrait plus "+adminPowers+".")
		if own {
			lines = append(lines, "C'est ton propre compte : les outils admin_… disparaîtraient de cet assistant dès sa requête suivante.")
		}
	}
	r := &risk{Message: strings.Join(lines, " "), Details: lines, Records: []stamp{{Collection: "users", ID: account.ID, Updated: account.Updated}}}
	proceed, out, notice, err := t.guard(ctx, "admin_set_role", struct{ Runner, Role string }{runner.ID, role}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, setRoleOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	updated, err := t.updateAccount(ctx, account.ID, "role", role)
	if err != nil {
		return fail(err)
	}

	summary := fmt.Sprintf("%s est maintenant %s.", who, roleWords[updated.Role])
	if own && updated.Role != accountAdmin {
		summary = "Tu n'es plus admin : les outils admin_… disparaissent de cet assistant dès sa requête suivante."
	}
	return nil, setRoleOut{writeStatus: writeStatus{Done: true, Summary: summary}, Runner: ptr(runner.ref()), Role: updated.Role}, nil
}

type setDisabledIn struct {
	Runner       string `json:"runner" jsonschema:"l'identifiant ou le nom du coureur dont le compte est désactivé ou réactivé (admin_list_members les donne)"`
	Disabled     bool   `json:"disabled" jsonschema:"true pour désactiver le compte, false pour le réactiver"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"désactiver : le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in setDisabledIn) confirmationGiven() string { return in.Confirmation }

type setDisabledOut struct {
	writeStatus
	Runner   *runnerRef `json:"runner,omitempty" jsonschema:"le coureur du compte"`
	Disabled *bool      `json:"disabled,omitempty" jsonschema:"vrai quand le compte est désactivé, maintenant ; absent quand rien n'a été fait faute d'accord"`
}

var setDisabledSchema = sync.OnceValue(writeSchema[setDisabledOut])

func addAdminSetDisabled(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_set_disabled",
		Title: "Désactiver ou réactiver un compte",
		Description: "Membres → « Désactiver », « Réactiver » : un compte désactivé ne se connecte plus ; ses sessions ouvertes sont fermées tout de suite et ses jetons d'assistant (MCP) supprimés. " +
			"Le coureur et ses participations restent. Le site garde toujours un admin actif : il refuse de désactiver le dernier (last_admin). " +
			"Désactiver son propre compte (s'il reste un autre admin) supprime aussi le jeton de cet assistant : la réponse le dit, et c'est son dernier appel. " +
			"Désactiver demande toujours une confirmation ; réactiver se fait tout de suite (les anciens jetons ne reviennent pas).",
		InputSchema:  inputSchema[setDisabledIn](nil),
		OutputSchema: setDisabledSchema(),
		Annotations:  writeAnnotations(true, true),
	}, adminWrite(t, "admin_set_disabled", t.adminSetDisabled))
}

func (t *tools) adminSetDisabled(ctx context.Context, _ *mcpsdk.CallToolRequest, in setDisabledIn) (*mcpsdk.CallToolResult, setDisabledOut, error) {
	if err := requireAdmin(ctx, "admin_set_disabled"); err != nil {
		return nil, setDisabledOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, setDisabledOut, error) {
		return nil, setDisabledOut{}, describe(t.app, err, nil)
	}
	c, err := callerOf(ctx)
	if err != nil {
		return fail(err)
	}
	runner, account, err := t.accountNamed(ctx, in.Runner)
	if err != nil {
		return nil, setDisabledOut{}, err
	}
	own := account.ID == c.user.Id
	if account.Disabled == in.Disabled {
		state := "actif"
		if account.Disabled {
			state = "désactivé"
		}
		whose := "le compte de " + plain(runner.Name)
		if own {
			whose = "ton compte"
		}
		return nil, setDisabledOut{
			writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("Rien à changer : %s est déjà %s.", whose, state)},
			Runner:      ptr(runner.ref()), Disabled: ptr(account.Disabled),
		}, nil
	}

	// Disabling is asked: the account is shut out, its sessions and its tokens end.
	// Enabling is written at once.
	var r *risk
	if in.Disabled {
		var lines []string
		if own {
			lines = []string{
				"Ton compte serait désactivé : tu ne pourrais plus te connecter, tes sessions ouvertes seraient fermées tout de suite et tes jetons d'assistant (MCP) supprimés.",
				"C'est ton propre compte : le jeton de cet assistant serait supprimé avec les autres, et cet appel sera son dernier.",
			}
		} else {
			lines = []string{fmt.Sprintf("Le compte de %s serait désactivé : %s ne pourrait plus se connecter, ses sessions ouvertes seraient fermées tout de suite et ses jetons d'assistant (MCP) supprimés. "+
				"Tu pourras réactiver le compte, mais pas ces jetons.", plain(runner.Name), plain(runner.Name))}
		}
		r = &risk{Message: strings.Join(lines, " "), Details: lines, Records: []stamp{{Collection: "users", ID: account.ID, Updated: account.Updated}}}
	}
	proceed, out, notice, err := t.guard(ctx, "admin_set_disabled", struct {
		Runner   string
		Disabled bool
	}{runner.ID, in.Disabled}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, setDisabledOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	updated, err := t.updateAccount(ctx, account.ID, "disabled", in.Disabled)
	if err != nil {
		return fail(err)
	}

	var summary string
	switch {
	case updated.Disabled && own:
		summary = "Ton compte est désactivé : ce jeton ne marche plus, et cet appel était le dernier de cet assistant. Un autre admin peut réactiver le compte."
	case updated.Disabled:
		summary = fmt.Sprintf("Le compte de %s est désactivé : ses sessions sont fermées et ses jetons d'assistant (MCP) supprimés. admin_set_disabled (disabled: false) le réactive.", plain(runner.Name))
	default:
		summary = fmt.Sprintf("Le compte de %s est réactivé : %s peut se connecter de nouveau. Ses anciens jetons d'assistant ne reviennent pas : un nouveau se crée dans les Réglages du site.", plain(runner.Name), plain(runner.Name))
	}
	return nil, setDisabledOut{writeStatus: writeStatus{Done: true, Summary: summary}, Runner: ptr(runner.ref()), Disabled: ptr(updated.Disabled)}, nil
}
