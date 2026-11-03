package mcp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// This file has the links of the admin (spec § 6.11): admin_create_link and
// admin_revoke_link, the « Inviter », « Régénérer l'invitation », « Lien de
// réinitialisation » and « Révoquer » of the members page. An account is only ever
// made by an invitation, as on the site: the person opens the link.
//
// The link is in the answer of the call that makes it, as the page shows it to the
// admin, and nowhere else: the route keeps only the hash of its token, the token
// is in the fragment of the address, and the package never logs it (the inner
// request is POST /api/app/invitations, whose path holds no token, and the answer
// of a request is not logged).

// linkNouns are the links as a sentence names them, by kind.
var linkNouns = map[string]string{linkInvite: "lien d'invitation", linkReset: "lien de réinitialisation"}

// waitingLinks are the links that wait for a runner, of either kind: not used and
// not expired. The one that is valid the longest comes first.
func (t *tools) waitingLinks(ctx context.Context, runnerID string) ([]invitationRecord, error) {
	// The id is the only thing of the filter: one that is not an id is not sent.
	if !isID(runnerID) {
		return nil, errors.New("mcp: the links of a runner id that is not an id")
	}
	links, err := listAll[invitationRecord](ctx, t.inner, "invitations", url.Values{
		"filter": {"(runner='" + runnerID + "' && used_at='')"},
		"fields": {invitationFields},
	}, 100)
	if err != nil {
		return nil, err
	}
	at := now()
	links = slices.DeleteFunc(links, func(link invitationRecord) bool {
		return link.Runner != runnerID || !isPending(link, at)
	})
	slices.SortFunc(links, func(a, b invitationRecord) int {
		x, _ := instantOf(a.ExpiresAt)
		y, _ := instantOf(b.ExpiresAt)
		return y.Compare(x)
	})
	return links, nil
}

// pendingLinks are the links of that kind that wait for a runner, the one that is
// valid the longest first: there is one, as the site replaces the one that waits
// when it makes another.
func (t *tools) pendingLinks(ctx context.Context, runnerID, kind string) ([]invitationRecord, error) {
	links, err := t.waitingLinks(ctx, runnerID)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(links, func(link invitationRecord) bool { return link.Kind != kind }), nil
}

// waitingLine says that a link that waits for a runner would stop working.
func waitingLine(link invitationRecord, runner runnerRecord) string {
	return fmt.Sprintf("Le %s en attente pour %s (valable jusqu'au %s) cessera de marcher.", linkNouns[link.Kind], plain(runner.Name), expiryDay(link.ExpiresAt))
}

// linkKindOf is the kind of a link that a tool is given, or the refusal.
func linkKindOf(kind string) (string, error) {
	if _, ok := linkNouns[kind]; !ok {
		return "", errors.New("kind est invite ou reset.")
	}
	return kind, nil
}

// ---------------------------------------------------------------------------
// admin_create_link

type createLinkIn struct {
	Runner       string `json:"runner" jsonschema:"l'identifiant ou le nom du coureur (admin_list_members les donne)"`
	Kind         string `json:"kind" jsonschema:"invite : pour un coureur sans compte, la personne crée son compte en ouvrant le lien ; reset : pour un coureur qui a un compte, la personne choisit un nouveau mot de passe (ses sessions sont fermées et ses jetons d'assistant supprimés quand elle s'en sert)"`
	Role         string `json:"role,omitempty" jsonschema:"invite seulement : le rôle du compte que l'invitation crée, member (par défaut) ou admin"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in createLinkIn) confirmationGiven() string { return in.Confirmation }

type createLinkOut struct {
	writeStatus
	URL       string `json:"url,omitempty" jsonschema:"le lien à transmettre à la personne, et à elle seule : il donne l'accès au compte"`
	ExpiresAt string `json:"expires_at,omitempty" jsonschema:"jusqu'à quand il marche, en UTC (7 jours)"`
}

var createLinkSchema = sync.OnceValue(writeSchema[createLinkOut])

func addAdminCreateLink(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_create_link",
		Title: "Créer un lien d'invitation ou de réinitialisation",
		Description: "Membres → « Inviter », « Régénérer l'invitation », « Lien de réinitialisation » : c'est ainsi qu'un compte se crée, comme sur le site. " +
			"kind invite, pour un coureur sans compte : la personne choisit son email et son mot de passe en ouvrant le lien (role : member par défaut, ou admin). " +
			"kind reset, pour un coureur qui a un compte : la personne choisit un nouveau mot de passe ; ses sessions ouvertes sont alors fermées, et ses jetons d'assistant (MCP) supprimés. " +
			"Le lien vaut 7 jours, et remplace celui du même genre qui attendait pour ce coureur. " +
			"Une réinitialisation demande toujours une confirmation ; une invitation, quand elle remplace un lien en attente ou donne le rôle admin. " +
			"Le lien donne l'accès au compte : ne le transmets qu'à la personne concernée, et ne l'écris nulle part ailleurs.",
		InputSchema:  inputSchema[createLinkIn](map[string][]string{"kind": {linkInvite, linkReset}, "role": {accountMember, accountAdmin}}),
		OutputSchema: createLinkSchema(),
		Annotations:  writeAnnotations(true, false),
	}, adminWrite(t, "admin_create_link", t.adminCreateLink))
}

func (t *tools) adminCreateLink(ctx context.Context, _ *mcpsdk.CallToolRequest, in createLinkIn) (*mcpsdk.CallToolResult, createLinkOut, error) {
	if err := requireAdmin(ctx, "admin_create_link"); err != nil {
		return nil, createLinkOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, createLinkOut, error) {
		return nil, createLinkOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, createLinkOut, error) {
		return nil, createLinkOut{}, err
	}
	kind, err := linkKindOf(in.Kind)
	if err != nil {
		return refuse(err)
	}
	role := strings.TrimSpace(in.Role)
	switch {
	case kind == linkReset && role != "":
		return refuse(errors.New("role ne sert qu'à une invitation (kind: invite) : un lien de réinitialisation garde le rôle du compte (admin_set_role le change)."))
	case kind == linkInvite && role == "":
		role = accountMember
	case kind == linkInvite && roleWords[role] == "":
		return refuse(errors.New("role est member ou admin."))
	}

	// The runners with their account: a reset of a disabled one is said to wait for
	// its reactivation.
	runners, err := t.memberRunners(ctx)
	if err != nil {
		return fail(err)
	}
	runner, err := memberNamed(runners, in.Runner)
	if err != nil {
		return refuse(err)
	}
	if !isID(runner.ID) {
		return fail(errors.New("mcp: a runner id that is not an id"))
	}
	// The refusal of the site (invitation_kind_mismatch): an invitation makes an
	// account, a reset changes the password of one.
	switch {
	case kind == linkInvite && runner.User != "":
		return refuse(fmt.Errorf("%s a déjà un compte : une invitation sert à en créer un. Pour un nouveau mot de passe, c'est kind: reset ; pour un autre rôle, admin_set_role. (invitation_kind_mismatch)", plain(runner.Name)))
	case kind == linkReset && runner.User == "":
		return refuse(fmt.Errorf("%s n'a pas de compte : un lien de réinitialisation sert à un compte qui existe. Pour lui en créer un, c'est kind: invite. (invitation_kind_mismatch)", plain(runner.Name)))
	}
	waiting, err := t.pendingLinks(ctx, runner.ID, kind)
	if err != nil {
		return fail(err)
	}

	// A reset is always asked: it opens an account to whoever has it. An invitation
	// is asked when it stops a link that waits, or when it makes an admin.
	var lines []string
	if kind == linkReset {
		lines = append(lines, fmt.Sprintf("Ce lien permet à qui l'ouvre de choisir un nouveau mot de passe pour le compte de %s, donc de se connecter en tant que %s : ne le donne qu'à %s. "+
			"Dès qu'il servira, les sessions ouvertes de ce compte seront fermées, et ses jetons d'assistant (MCP) supprimés.", plain(runner.Name), plain(runner.Name), plain(runner.Name)))
	} else if len(waiting) > 0 || role == accountAdmin {
		line := fmt.Sprintf("Ce lien permet à qui l'ouvre de créer le compte de %s, avec le rôle %s", plain(runner.Name), roleWords[role])
		if role == accountAdmin {
			line += " : ce compte pourra " + adminPowers
		}
		lines = append(lines, line+".")
	}
	records := []stamp{{Collection: "runners", ID: runner.ID, Updated: runner.Updated}}
	// The site makes the reset of a disabled account, and refuses it to the person
	// (account_disabled) until the account is enabled again.
	if account := runner.account(); kind == linkReset && account != nil {
		if account.Disabled {
			lines = append(lines, fmt.Sprintf("Le compte de %s est désactivé : ce lien ne servira qu'une fois le compte réactivé (admin_set_disabled).", plain(runner.Name)))
		}
		records = append(records, stamp{Collection: "users", ID: account.ID, Updated: account.Updated})
	}
	for _, link := range waiting {
		lines = append(lines, waitingLine(link, runner.runnerRecord))
		records = append(records, stamp{Collection: "invitations", ID: link.ID, Updated: link.Updated})
	}
	var r *risk
	if len(lines) > 0 {
		r = &risk{Message: strings.Join(lines, " "), Details: lines, Records: records}
	}
	proceed, out, notice, err := t.guard(ctx, "admin_create_link", struct{ Runner, Kind, Role string }{runner.ID, kind, role}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, createLinkOut{writeStatus: notDoneOut(out, notice)}, nil
	}

	// The body of the page: a reset has no role.
	body := map[string]any{"runnerId": runner.ID, "kind": kind}
	if kind == linkInvite {
		body["role"] = role
	}
	var made struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err := t.inner.send(ctx, http.MethodPost, "/api/app/invitations", body, &made); err != nil {
		return fail(err)
	}

	what := fmt.Sprintf("%s crée son compte (rôle %s) en l'ouvrant", plain(runner.Name), roleWords[role])
	if kind == linkReset {
		what = fmt.Sprintf("%s choisit un nouveau mot de passe en l'ouvrant ; ses sessions ouvertes sont alors fermées, et ses jetons d'assistant (MCP) supprimés", plain(runner.Name))
	}
	summary := fmt.Sprintf("%s pour %s, valable jusqu'au %s : %s. Ce lien donne l'accès au compte : ne le transmets qu'à %s, et ne l'écris nulle part ailleurs.",
		upperFirst(linkNouns[kind]), plain(runner.Name), expiryDay(made.ExpiresAt), what, plain(runner.Name))
	if len(waiting) > 0 {
		summary += " L'ancien lien ne fonctionne plus."
	}
	return nil, createLinkOut{writeStatus: writeStatus{Done: true, Summary: summary}, URL: made.URL, ExpiresAt: made.ExpiresAt}, nil
}

// ---------------------------------------------------------------------------
// admin_revoke_link

type revokeLinkIn struct {
	Runner       string `json:"runner" jsonschema:"l'identifiant ou le nom du coureur (admin_list_members les donne)"`
	Kind         string `json:"kind" jsonschema:"invite pour l'invitation qui attend, reset pour le lien de réinitialisation qui attend"`
	Confirmation string `json:"confirmation,omitempty" jsonschema:"le jeton de la confirmation que la réponse au premier appel a donné, quand la personne a accepté"`
}

func (in revokeLinkIn) confirmationGiven() string { return in.Confirmation }

// revokedLinkOut is a link that does not work any more.
type revokedLinkOut struct {
	ID        string `json:"id"`
	Kind      string `json:"kind" jsonschema:"invite ou reset"`
	ExpiresAt string `json:"expires_at" jsonschema:"le jour où il aurait expiré, à Paris"`
}

type revokeLinkOut struct {
	writeStatus
	Revoked *revokedLinkOut `json:"revoked,omitempty" jsonschema:"le lien révoqué"`
}

var revokeLinkSchema = sync.OnceValue(writeSchema[revokeLinkOut])

func addAdminRevokeLink(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "admin_revoke_link",
		Title: "Révoquer un lien",
		Description: "Membres → « Révoquer l'invitation », « Révoquer le lien » : le lien de ce genre qui attend pour ce coureur cesse de marcher. " +
			"Il demande toujours une confirmation : le premier appel ne fait rien, dit quel lien cesserait de marcher et jusqu'à quand il valait, et donne un jeton à redonner si la personne accepte.",
		InputSchema:  inputSchema[revokeLinkIn](map[string][]string{"kind": {linkInvite, linkReset}}),
		OutputSchema: revokeLinkSchema(),
		Annotations:  writeAnnotations(true, false),
	}, adminWrite(t, "admin_revoke_link", t.adminRevokeLink))
}

func (t *tools) adminRevokeLink(ctx context.Context, _ *mcpsdk.CallToolRequest, in revokeLinkIn) (*mcpsdk.CallToolResult, revokeLinkOut, error) {
	if err := requireAdmin(ctx, "admin_revoke_link"); err != nil {
		return nil, revokeLinkOut{}, err
	}
	fail := func(err error) (*mcpsdk.CallToolResult, revokeLinkOut, error) {
		return nil, revokeLinkOut{}, describe(t.app, err, nil)
	}
	refuse := func(err error) (*mcpsdk.CallToolResult, revokeLinkOut, error) {
		return nil, revokeLinkOut{}, err
	}
	kind, err := linkKindOf(in.Kind)
	if err != nil {
		return refuse(err)
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
	waiting, err := t.pendingLinks(ctx, runner.ID, kind)
	if err != nil {
		return fail(err)
	}
	if len(waiting) == 0 {
		return refuse(fmt.Errorf("Aucun lien en attente pour %s : pas de %s qui marche encore à révoquer.", plain(runner.Name), linkNouns[kind]))
	}
	// The one that the page shows: the one valid the longest.
	link := waiting[0]
	if !isID(link.ID) {
		return fail(errors.New("mcp: a link id that is not an id"))
	}
	day := expiryDay(link.ExpiresAt)

	// Always asked: the person who has the link cannot use it any more.
	line := fmt.Sprintf("Le %s %s (valable jusqu'au %s) ne fonctionnera plus.", linkNouns[kind], ofName(runner.Name), day)
	r := &risk{Message: line, Details: []string{line}, Records: []stamp{{Collection: "invitations", ID: link.ID, Updated: link.Updated}}}
	proceed, out, notice, err := t.guard(ctx, "admin_revoke_link", struct{ Runner, Kind string }{runner.ID, kind}, r, strings.TrimSpace(in.Confirmation))
	if err != nil {
		return fail(err)
	}
	if !proceed {
		return nil, revokeLinkOut{writeStatus: notDoneOut(out, notice)}, nil
	}
	if err := t.inner.send(ctx, http.MethodDelete, "/api/app/invitations/"+link.ID, nil, nil); err != nil {
		return fail(err)
	}
	return nil, revokeLinkOut{
		writeStatus: writeStatus{Done: true, Summary: fmt.Sprintf("Le %s %s est révoqué : il ne fonctionne plus.", linkNouns[kind], ofName(runner.Name))},
		Revoked:     &revokedLinkOut{ID: link.ID, Kind: kind, ExpiresAt: day},
	}, nil
}
