package mcp_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/logger"

	"courses/server/invitations"
	"courses/server/mcp"
	"courses/server/testutil"
)

// The links of the admin (spec § 6.11): an invitation, which is how an account is
// made, and a link to choose a new password.
//
// The settings limit what is under /api/app/invitations/ to 10 requests a minute
// per address, the lookups of the page included: the tests that send them use an
// application each, and stay under 8.

// linkWaiting makes a link of that kind for a runner, as the site does, and
// returns its record: its token is not kept.
func linkWaiting(t testing.TB, app core.App, runner *core.Record, kind, role string) *core.Record {
	t.Helper()
	_, inv, err := invitations.Create(app, invitations.CreateInput{RunnerID: runner.Id, Kind: invitations.Kind(kind), Role: role})
	if err != nil {
		t.Fatalf("making a link: %v", err)
	}
	return inv
}

// parisDayOf is the day, in Paris, of a date and time of a record.
func parisDayOf(t testing.TB, record *core.Record, field string) string {
	t.Helper()
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Fatal(err)
	}
	return record.GetDateTime(field).Time().In(paris).Format(time.DateOnly)
}

// linksOf are the links of a runner, as the database has them, the latest first.
func linksOf(t testing.TB, app core.App, runner *core.Record) []*core.Record {
	t.Helper()
	found, err := app.FindRecordsByFilter("invitations", "runner = {:runner}", "-created", 0, 0, dbx.Params{"runner": runner.Id})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// linkIn is the address of the link of an answer, and its token: the fragment.
func linkIn(t testing.TB, result toolResult) (address, token string) {
	t.Helper()
	address, _ = result.Structured["url"].(string)
	const start = siteURL + "/invitation#"
	if !strings.HasPrefix(address, start) || len(address) == len(start) {
		t.Fatalf("the link is %.40q…, want %s and a token", address, start)
	}
	return address, strings.TrimPrefix(address, start)
}

// looksUp checks what the page of an invitation is answered for the token.
func looksUp(t *testing.T, app *tests.TestApp, token string, status int) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"token": token})
	if err != nil {
		t.Fatal(err)
	}
	(&tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/app/invitations/lookup",
		Body:                  strings.NewReader(string(body)),
		Headers:               map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:        status,
		NotExpectedContent:    []string{"\x00"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// expiresIn7Days checks that an answer's expires_at is the one of the route: a
// UTC time, 7 days from now.
func expiresIn7Days(t testing.TB, result toolResult) {
	t.Helper()
	text, _ := result.Structured["expires_at"].(string)
	at, err := time.Parse(time.RFC3339, text)
	if err != nil || !strings.HasSuffix(text, "Z") {
		t.Fatalf("expires_at = %q, want a UTC time", text)
	}
	if want := time.Now().Add(7 * 24 * time.Hour); at.Before(want.Add(-time.Minute)) || at.After(want.Add(time.Minute)) {
		t.Errorf("expires_at = %s, want 7 days from now (%s)", text, want.UTC().Format(time.RFC3339))
	}
}

// An invitation: written at once when nothing waits and the role is member; asked
// when it replaces a pending one, or gives the admin role.
func TestAdmin_CreateLink_Invite(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	admin := newToken(t, app, fx.Admin)
	julie := create(t, app, "runners", map[string]any{"name": "Julie"})
	args := map[string]any{"runner": "Julie", "kind": "invite"}

	counted := mcp.CountInnerRequests(t)
	first := isDone(t, callTool(t, app, admin, "admin_create_link", args))
	_, oldToken := linkIn(t, first)
	expiresIn7Days(t, first)
	if got := counted.Of(http.MethodPost); got != 1 {
		t.Errorf("%d POST, want the one of the route", got)
	}
	if summary := summaryOfResult(first); !strings.Contains(summary, "Julie crée son compte (rôle membre)") ||
		!strings.Contains(summary, "ne le transmets qu'à Julie") || !strings.Contains(summary, "ne l'écris nulle part ailleurs") {
		t.Errorf("the summary %q does not say what the link is for, and whom", summary)
	}
	links := linksOf(t, app, julie)
	if len(links) != 1 || links[0].GetString("kind") != "invite" || links[0].GetString("role") != "member" {
		t.Fatalf("Julie's links: %v, want an invitation as a member", links)
	}

	// Again: it replaces the one waiting, which stops working.
	var message string
	var details []string
	writesNothing(t, app, func() {
		_, message, details = asked(t, callTool(t, app, admin, "admin_create_link", args))
	})
	mentions(t, message, details, "créer le compte de Julie",
		"Le lien d'invitation en attente pour Julie (valable jusqu'au "+parisDayOf(t, links[0], "expires_at")+") cessera de marcher")
	// The role that is not given is member: the same request as with it.
	token, _, _ := asked(t, callTool(t, app, admin, "admin_create_link", args))
	second := isDone(t, callTool(t, app, admin, "admin_create_link", map[string]any{"runner": julie.Id, "kind": "invite", "role": "member", "confirmation": token}))
	_, freshToken := linkIn(t, second)
	if freshToken == oldToken {
		t.Fatal("the new link is the old one")
	}
	looksUp(t, app, oldToken, http.StatusNotFound)
	looksUp(t, app, freshToken, http.StatusOK)

	// An invitation that gives the admin role is asked (the one without anything
	// waiting is a row of TestTools_Confirmation_NothingWrittenFirst).
	writesNothing(t, app, func() {
		_, message, details = asked(t, callTool(t, app, admin, "admin_create_link", map[string]any{"runner": "Julie", "kind": "invite", "role": "admin"}))
	})
	mentions(t, message, details, "avec le rôle admin", "gérer les membres")
	confirmAndCall(t, app, admin, "admin_create_link", map[string]any{"runner": "Julie", "kind": "invite", "role": "admin"})
	if links := linksOf(t, app, julie); len(links) != 1 || links[0].GetString("role") != "admin" {
		t.Errorf("Julie's links: %v, want one invitation as an admin", links)
	}
}

// A reset is always asked; a link that does not fit the runner is the site's
// refusal, announced.
func TestAdmin_CreateLink_Reset(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	admin := newToken(t, app, fx.Admin)

	args := map[string]any{"runner": "Bob", "kind": "reset"}
	var message string
	var details []string
	writesNothing(t, app, func() {
		_, message, details = asked(t, callTool(t, app, admin, "admin_create_link", args))
	})
	mentions(t, message, details, "nouveau mot de passe pour le compte de Bob", "se connecter en tant que Bob", "sessions ouvertes",
		"ses jetons d'assistant (MCP) supprimés")
	result := confirmAndCall(t, app, admin, "admin_create_link", args)
	linkIn(t, result)
	expiresIn7Days(t, result)
	if summary, _ := result.Structured["summary"].(string); !strings.Contains(summary, "ses jetons d'assistant (MCP) supprimés") {
		t.Errorf("the summary of a reset says %q, want that the tokens of the account go", summary)
	}
	if links := linksOf(t, app, fx.BobRunner); len(links) != 1 || links[0].GetString("kind") != "reset" || links[0].GetString("role") != "" {
		t.Errorf("Bob's links: %v, want a reset", links)
	}

	// A reset for an account that is disabled: the site makes it, and refuses it to
	// the person until the account is enabled again.
	update(t, app, fx.Bob, map[string]any{"disabled": true})
	writesNothing(t, app, func() {
		_, message, details = asked(t, callTool(t, app, admin, "admin_create_link", args))
	})
	mentions(t, message, details, "Le compte de Bob est désactivé : ce lien ne servira qu'une fois le compte réactivé (admin_set_disabled).")
	update(t, app, fx.Bob, map[string]any{"disabled": false})

	announced(t, app, admin, "admin_create_link", map[string]any{"runner": "Bob", "kind": "invite"}, "Bob a déjà un compte")
	announced(t, app, admin, "admin_create_link", map[string]any{"runner": "Bob", "kind": "invite"}, "(invitation_kind_mismatch)")
	announced(t, app, admin, "admin_create_link", map[string]any{"runner": "Sam", "kind": "reset"}, "Sam n'a pas de compte")
	announced(t, app, admin, "admin_create_link", map[string]any{"runner": "Sam", "kind": "reset"}, "(invitation_kind_mismatch)")
	announced(t, app, admin, "admin_create_link", map[string]any{"runner": "Bob", "kind": "reset", "role": "admin"}, "role ne sert qu'à une invitation")
}

func TestAdmin_RevokeLink(t *testing.T) {
	app, fx, admin := adminApp(t)

	t.Run("an invitation, once the person agrees", func(t *testing.T) {
		waiting := linkWaiting(t, app, fx.SamRunner, "invite", "member")
		args := map[string]any{"runner": "Sam", "kind": "invite"}
		var message string
		var details []string
		writesNothing(t, app, func() {
			_, message, details = asked(t, callTool(t, app, admin, "admin_revoke_link", args))
		})
		mentions(t, message, details, "Le lien d'invitation de Sam (valable jusqu'au "+parisDayOf(t, waiting, "expires_at")+") ne fonctionnera plus")
		result := confirmAndCall(t, app, admin, "admin_revoke_link", args)
		if storedRecord(t, app, "invitations", waiting.Id) != nil {
			t.Error("the invitation is still there")
		}
		assertJSON(t, result.Structured["revoked"], map[string]any{"id": waiting.Id, "kind": "invite", "expires_at": parisDayOf(t, waiting, "expires_at")})
	})

	t.Run("none waiting", func(t *testing.T) {
		announced(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Sam", "kind": "invite"}, "Aucun lien en attente pour Sam")
	})

	t.Run("an invitation that has expired is not waiting", func(t *testing.T) {
		expired := linkWaiting(t, app, fx.SamRunner, "invite", "member")
		update(t, app, expired, map[string]any{"expires_at": time.Now().Add(-time.Hour)})
		announced(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Sam", "kind": "invite"}, "Aucun lien en attente pour Sam")
		// Nor is it one that a new invitation would stop: nothing to ask.
		writes := mcp.CountInnerRequests(t)
		isDone(t, callTool(t, app, admin, "admin_create_link", map[string]any{"runner": "Sam", "kind": "invite"}))
		if got := writes.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want the one of the route", got)
		}
	})

	t.Run("two invitations waiting, which the site never makes: the one the page shows", func(t *testing.T) {
		waiting := func(hash string, days int) *core.Record {
			return create(t, app, "invitations", map[string]any{
				"runner": fx.SamRunner.Id, "kind": "invite", "role": "member", "token_hash": hash,
				"expires_at": time.Now().Add(time.Duration(days) * 24 * time.Hour),
			})
		}
		// Beyond the 7 days of the one that the case above made.
		sooner, later := waiting(strings.Repeat("a", 64), 8), waiting(strings.Repeat("b", 64), 9)
		confirmAndCall(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Sam", "kind": "invite"})
		if storedRecord(t, app, "invitations", later.Id) != nil || storedRecord(t, app, "invitations", sooner.Id) == nil {
			t.Error("the invitation revoked is not the one valid the longest")
		}
		if err := app.Delete(storedRecord(t, app, "invitations", sooner.Id)); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a reset, not an invitation", func(t *testing.T) {
		waiting := linkWaiting(t, app, fx.BobRunner, "reset", "")
		announced(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Bob", "kind": "invite"}, "Aucun lien en attente pour Bob")
		_, message, details := asked(t, callTool(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Bob", "kind": "reset"}))
		mentions(t, message, details, "Le lien de réinitialisation de Bob")
		confirmAndCall(t, app, admin, "admin_revoke_link", map[string]any{"runner": "Bob", "kind": "reset"})
		if storedRecord(t, app, "invitations", waiting.Id) != nil {
			t.Error("the reset is still there")
		}
	})
}

// The link is in the answer, and nowhere else: not in the request log, at the
// Debug level, neither its token nor the hash that the site keeps.
func TestAdmin_LinkIsNotLogged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	app.Settings().Logs.MaxDays = 5
	app.Settings().Logs.MinLevel = int(slog.LevelDebug)
	handler, ok := app.Logger().Handler().(*logger.BatchHandler)
	if !ok {
		t.Fatalf("the logger is a %T, want PocketBase's batch handler", app.Logger().Handler())
	}
	handler.SetLevel(slog.LevelDebug)
	admin := newToken(t, app, fx.Admin)

	result := isDone(t, callTool(t, app, admin, "admin_create_link", map[string]any{"runner": "Sam", "kind": "invite"}))
	address, token := linkIn(t, result)
	secrets := map[string]string{"the link": address, "its token": token, "the hash of its token": invitations.Hash(token)}

	// /mcp, and the inner requests: the runners, the links, and the route.
	logs := waitForRequests(t, app, 4)
	route := false
	for _, entry := range logs {
		data, err := json.Marshal(entry.Data)
		if err != nil {
			t.Fatal(err)
		}
		text := entry.Message + " " + string(data)
		for name, secret := range secrets {
			if strings.Contains(text, secret) {
				t.Errorf("the log holds %s (%s) in the entry %q", name, prefix(secret), entry.Message)
			}
		}
		if entry.Message == "POST /api/app/invitations" && entry.Data["userAgent"] == "prends-ton-dossard-mcp" {
			route = true
		}
	}
	if !route {
		t.Error("no inner POST /api/app/invitations in the log")
	}
}
