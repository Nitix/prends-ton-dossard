package mcp_test

import (
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The members page of the admin (spec § 6.11): the list, the runners, the roles
// and the accounts turned off.

// adminApp is a fresh application with the fixture and the token of the admin.
func adminApp(t *testing.T) (*tests.TestApp, testutil.Fixture, string) {
	t.Helper()
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	return app, fx, newToken(t, app, fx.Admin)
}

// accountUpdates notes each update of an account that the site is sent: the
// fields that it asks back, and the fields of its body.
func accountUpdates(t *testing.T, app *tests.TestApp) *[]string {
	t.Helper()
	var updates []string
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return err
		}
		updates = append(updates, "fields="+e.Request.URL.Query().Get("fields")+" body="+strings.Join(slices.Sorted(maps.Keys(info.Body)), ","))
		return e.Next()
	})
	return &updates
}

// sentOnly checks that the updates of an account were each sent with only that
// field, and asked back no email.
func sentOnly(t *testing.T, updates []string, field string) {
	t.Helper()
	if len(updates) == 0 {
		t.Fatal("no update of an account was sent")
	}
	for _, update := range updates {
		if update != "fields=id,role,disabled,updated body="+field {
			t.Errorf("an account was updated with %q, want only %s, and only its role and state asked back", update, field)
		}
	}
}

// read checks that a read answered, with the JSON of its answer as its text.
func read(t *testing.T, result toolResult) toolResult {
	t.Helper()
	succeeded(t, result)
	textIs(t, result)
	return result
}

// The cases of web/src/features/admin/memberState.test.ts, for the port of
// memberState, toMembers and expiryDay.
func TestMemberState(t *testing.T) {
	sam := mcp.RunnerRecord{ID: "samRunner", Name: "Sam"}
	alice := mcp.RunnerRecord{ID: "aliceRunner", Name: "Alice", User: "aliceUser"}
	aliceUser := mcp.AccountRecord{ID: "aliceUser", Role: "member"}
	// A pending invitation for Sam, which expires on 7 November 2026 at noon (UTC).
	invitation := mcp.InvitationRecord{
		ID: "inv1", Runner: sam.ID, Kind: "invite", Role: "member", ExpiresAt: "2026-11-07 12:00:00.000Z",
	}
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	changed := func(base mcp.InvitationRecord, change func(*mcp.InvitationRecord)) *mcp.InvitationRecord {
		change(&base)
		return &base
	}
	disabled := aliceUser
	disabled.Disabled = true

	t.Run("memberState", func(t *testing.T) {
		for _, row := range []struct {
			name    string
			runner  mcp.RunnerRecord
			user    *mcp.AccountRecord
			pending *mcp.InvitationRecord
			want    string
		}{
			{"pas de compte et pas d'invitation : no_account", sam, nil, nil, "no_account"},
			{"invitation en attente non expirée : invited", sam, nil, &invitation, "invited"},
			{"invitation expirée : no_account", sam, nil, changed(invitation, func(i *mcp.InvitationRecord) { i.ExpiresAt = "2026-10-31 23:59:59.000Z" }), "no_account"},
			{"une invitation qui expire à l'instant même est expirée", sam, nil, changed(invitation, func(i *mcp.InvitationRecord) { i.ExpiresAt = "2026-11-01 09:00:00.000Z" }), "no_account"},
			{"une invitation déjà utilisée n'est pas en attente", sam, nil, changed(invitation, func(i *mcp.InvitationRecord) { i.UsedAt = "2026-11-02 08:00:00.000Z" }), "no_account"},
			{"l'invitation d'un autre coureur ne compte pas", sam, nil, changed(invitation, func(i *mcp.InvitationRecord) { i.Runner = "someoneElse" }), "no_account"},
			{"compte : active", alice, &aliceUser, nil, "active"},
			{"compte avec disabled : disabled", alice, &disabled, nil, "disabled"},
			{"le compte l'emporte sur une invitation restée en attente", alice, &aliceUser, changed(invitation, func(i *mcp.InvitationRecord) { i.Runner = alice.ID }), "active"},
		} {
			t.Run(row.name, func(t *testing.T) {
				if got := mcp.MemberState(row.runner, row.user, row.pending, now); got != row.want {
					t.Errorf("memberState = %q, want %q", got, row.want)
				}
			})
		}
	})

	t.Run("toMembers", func(t *testing.T) {
		reset := *changed(invitation, func(i *mcp.InvitationRecord) {
			i.ID, i.Runner, i.Kind, i.ExpiresAt = "reset1", alice.ID, "reset", "2026-11-05 10:00:00.000Z"
		})
		withUser := mcp.WithAccount(alice, &aliceUser)
		withoutUser := mcp.WithAccount(sam, nil)

		t.Run("range les coureurs par nom, avec leur compte et leur état", func(t *testing.T) {
			members := mcp.ToMembers([]mcp.MemberRunner{withoutUser, withUser}, nil, now)
			if len(members) != 2 || members[0].Runner != "Alice" || members[0].State != "active" || members[1].Runner != "Sam" || members[1].State != "no_account" {
				t.Fatalf("members = %+v, want Alice active, then Sam no_account", members)
			}
			if members[0].User == nil || *members[0].User != aliceUser {
				t.Errorf("Alice's account is %+v, want %+v", members[0].User, aliceUser)
			}
			if members[1].User != nil {
				t.Errorf("Sam has the account %+v", members[1].User)
			}
		})

		t.Run("donne à un coureur sans compte son invitation en attente", func(t *testing.T) {
			members := mcp.ToMembers([]mcp.MemberRunner{withoutUser}, []mcp.InvitationRecord{invitation}, now)
			if members[0].State != "invited" || members[0].Invitation == nil || *members[0].Invitation != invitation {
				t.Errorf("Sam: %+v, want invited with the invitation", members[0])
			}
		})

		t.Run("une invitation expirée n'est plus rattachée au coureur", func(t *testing.T) {
			expired := *changed(invitation, func(i *mcp.InvitationRecord) { i.ExpiresAt = "2026-10-01 12:00:00.000Z" })
			members := mcp.ToMembers([]mcp.MemberRunner{withoutUser}, []mcp.InvitationRecord{expired}, now)
			if members[0].State != "no_account" || members[0].Invitation != nil {
				t.Errorf("Sam: %+v, want no_account without an invitation", members[0])
			}
		})

		t.Run("garde, d'un coureur qui a deux invitations en attente, celle qui expire le plus tard", func(t *testing.T) {
			newer := *changed(invitation, func(i *mcp.InvitationRecord) { i.ID, i.ExpiresAt = "inv2", "2026-11-09 12:00:00.000Z" })
			members := mcp.ToMembers([]mcp.MemberRunner{withoutUser}, []mcp.InvitationRecord{invitation, newer}, now)
			if members[0].Invitation == nil || members[0].Invitation.ID != "inv2" {
				t.Errorf("Sam's invitation is %+v, want inv2", members[0].Invitation)
			}
		})

		t.Run("un lien de réinitialisation en attente est celui d'un coureur qui a un compte", func(t *testing.T) {
			members := mcp.ToMembers([]mcp.MemberRunner{withUser}, []mcp.InvitationRecord{reset}, now)
			if members[0].State != "active" || members[0].Invitation != nil || members[0].Reset == nil || *members[0].Reset != reset {
				t.Errorf("Alice: %+v, want active with the reset and no invitation", members[0])
			}
		})

		t.Run("un lien de réinitialisation expiré est ignoré", func(t *testing.T) {
			expired := *changed(reset, func(i *mcp.InvitationRecord) { i.ExpiresAt = "2026-10-30 10:00:00.000Z" })
			members := mcp.ToMembers([]mcp.MemberRunner{withUser}, []mcp.InvitationRecord{expired}, now)
			if members[0].Reset != nil {
				t.Errorf("Alice has the reset %+v", members[0].Reset)
			}
		})

		t.Run("ne laisse pas l'invitation d'un coureur à un autre", func(t *testing.T) {
			members := mcp.ToMembers([]mcp.MemberRunner{withoutUser, withUser}, []mcp.InvitationRecord{invitation}, now)
			for _, m := range members {
				switch {
				case m.Runner == "Alice" && m.Invitation != nil:
					t.Errorf("Alice has Sam's invitation %+v", m.Invitation)
				case m.Runner == "Sam" && (m.Invitation == nil || *m.Invitation != invitation):
					t.Errorf("Sam's invitation is %+v", m.Invitation)
				}
			}
		})
	})

	t.Run("expiryDay", func(t *testing.T) {
		for _, row := range []struct{ name, expiresAt, want string }{
			{"lit une date-heure de PocketBase", "2026-11-07 12:00:00.000Z", "2026-11-07"},
			{"lit une date-heure RFC 3339, celle de la route des invitations", "2026-11-07T12:00:00Z", "2026-11-07"},
			{"compte le jour à Paris : 23 h 30 UTC, c'est déjà le lendemain", "2026-11-07 23:30:00.000Z", "2026-11-08"},
		} {
			t.Run(row.name, func(t *testing.T) {
				if got := mcp.ExpiryDay(row.expiresAt); got != row.want {
					t.Errorf("expiryDay(%q) = %q, want %q", row.expiresAt, got, row.want)
				}
			})
		}
	})
}

func TestAdmin_ListMembers(t *testing.T) {
	app, fx, admin := adminApp(t)
	// Julie, a new runner, has an invitation waiting; Bob, a link to choose a new
	// password; Alice, a passkey.
	julie := create(t, app, "runners", map[string]any{"name": "Julie"})
	invite := linkWaiting(t, app, julie, "invite", "member")
	reset := linkWaiting(t, app, fx.BobRunner, "reset", "")
	passkeyFor(t, app, fx.Alice, "iPhone")

	// What the requests ask the site for: never an email, a hash or a credential.
	fieldsAsked := map[string]string{}
	app.OnRecordsListRequest("runners", "invitations", "passkeys", "participations").BindFunc(func(e *core.RecordsListRequestEvent) error {
		fieldsAsked[e.Collection.Name] = e.Request.URL.Query().Get("fields")
		return e.Next()
	})

	result := read(t, callTool(t, app, admin, "admin_list_members", nil))
	pending := func(r *core.Record, withRole bool) map[string]any {
		out := map[string]any{"id": r.Id, "expires_at": parisDayOf(t, r, "expires_at")}
		if withRole {
			out["role"] = "member"
		}
		return out
	}
	assertJSON(t, result.Structured["members"], []any{
		map[string]any{"runner": runnerRef(fx.AdminRunner), "state": "active", "state_label": "Actif", "role": "admin", "participations": 0, "passkeys": 0},
		map[string]any{"runner": runnerRef(fx.AliceRunner), "state": "active", "state_label": "Actif", "role": "member", "participations": 1, "passkeys": 1},
		map[string]any{"runner": runnerRef(fx.BobRunner), "state": "active", "state_label": "Actif", "role": "member", "participations": 1, "passkeys": 0, "reset": pending(reset, false)},
		map[string]any{"runner": runnerRef(julie), "state": "invited", "state_label": "Invitation en attente", "participations": 0, "invitation": pending(invite, true)},
		map[string]any{"runner": runnerRef(fx.SamRunner), "state": "no_account", "state_label": "Sans compte", "participations": 1},
	})
	holdsNone(t, result, "@", "email", "credential", "token_hash", fx.Alice.Id, fx.Bob.Id, fx.Admin.Id)
	for _, collection := range []string{"runners", "invitations", "passkeys", "participations"} {
		fields, ok := fieldsAsked[collection]
		if !ok {
			t.Errorf("no request for the %s", collection)
			continue
		}
		if fields == "" || strings.Contains(fields, "*") || strings.Contains(fields, "email") || strings.Contains(fields, "token_hash") || strings.Contains(fields, "credential") {
			t.Errorf("the %s are asked with the fields %q, want only what the list says", collection, fields)
		}
	}

	t.Run("a name", func(t *testing.T) {
		result := read(t, callTool(t, app, admin, "admin_list_members", map[string]any{"query": "ali"}))
		members, _ := result.Structured["members"].([]any)
		if len(members) != 1 || members[0].(map[string]any)["runner"].(map[string]any)["name"] != "Alice" {
			t.Errorf("the members named like « ali » are %v, want Alice", members)
		}
	})

	t.Run("a disabled account", func(t *testing.T) {
		update(t, app, fx.Bob, map[string]any{"disabled": true})
		result := read(t, callTool(t, app, admin, "admin_list_members", map[string]any{"query": "Bob"}))
		members, _ := result.Structured["members"].([]any)
		if len(members) != 1 || members[0].(map[string]any)["state"] != "disabled" || members[0].(map[string]any)["state_label"] != "Désactivé" {
			t.Errorf("Bob is %v, want disabled", members)
		}
	})

	// The participations and the passkeys are counted, not read: years of races
	// do not make the list fail at the bound of a read.
	t.Run("more participations than a read takes", func(t *testing.T) {
		for i := range 6 {
			format := create(t, app, "formats", map[string]any{"event": fx.Event.Id, "race_type": fx.Trail.Id, "distance_km": 20 + i})
			joined(t, app, fx.SamRunner, format, "interested", false, fx.AliceRunner)
		}
		// The runners (5) and the links (2) fit; the participations (9) do not.
		mcp.SetMaxRecords(t, 6)
		result := read(t, callTool(t, app, admin, "admin_list_members", map[string]any{"query": "Sam"}))
		members, _ := result.Structured["members"].([]any)
		if len(members) != 1 || members[0].(map[string]any)["participations"] != float64(7) {
			t.Errorf("Sam is %v, want 7 participations", members)
		}
	})
}

func TestAdmin_Runners(t *testing.T) {
	app, fx, admin := adminApp(t)

	var julie string
	t.Run("a new runner, without the blanks around the name", func(t *testing.T) {
		result := isDone(t, callTool(t, app, admin, "admin_create_runner", map[string]any{"name": "  Julie  "}))
		runner, _ := result.Structured["runner"].(map[string]any)
		julie, _ = runner["id"].(string)
		assertJSON(t, runner, map[string]any{"id": julie, "name": "Julie", "has_account": false, "is_me": false, "url": siteURL + "/coureurs/" + julie})
		if summary := summaryOfResult(result); !strings.Contains(summary, "admin_create_link") {
			t.Errorf("the summary %q does not say how to make the account", summary)
		}
		listed := succeeded(t, callTool(t, app, admin, "list_runners", map[string]any{"query": "julie"}))
		if runners, _ := listed.Structured["runners"].([]any); len(runners) != 1 {
			t.Errorf("list_runners gives %v, want Julie", runners)
		}
	})

	t.Run("a name that is taken, whatever the case", func(t *testing.T) {
		refused(t, app, admin, "admin_create_runner", map[string]any{"name": "julie"}, "nom : cette valeur est déjà utilisée. (validation_not_unique)")
	})

	t.Run("a runner without an account or a participation is deleted, once the person agrees", func(t *testing.T) {
		// The invitation that waits for Julie goes with her.
		waiting := linkWaiting(t, app, storedRecord(t, app, "runners", julie), "invite", "member")
		var message string
		var details []string
		writesNothing(t, app, func() {
			_, message, details = asked(t, callTool(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Julie"}))
		})
		mentions(t, message, details, "Le coureur « Julie » (sans compte, sans participation) sera supprimé",
			"Le lien d'invitation en attente pour Julie (valable jusqu'au "+parisDayOf(t, waiting, "expires_at")+") cessera de marcher")
		result := confirmAndCall(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Julie"})
		assertJSON(t, result.Structured["removed"], map[string]any{"id": julie, "name": "Julie"})
		if storedRecord(t, app, "runners", julie) != nil {
			t.Error("Julie is still there")
		}
	})

	t.Run("a runner with participations: the site's refusal, announced", func(t *testing.T) {
		announced(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Sam"}, "Sam a 1 participation : retire-la d'abord. (runner_has_participations)")
		joined(t, app, fx.SamRunner, fx.FLyon, "interested", false, fx.AliceRunner)
		announced(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Sam"}, "Sam a 2 participations : retire-les d'abord. (runner_has_participations)")
	})

	t.Run("a runner with an account: the site's refusal, announced", func(t *testing.T) {
		announced(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Bob"}, "Bob a un compte : désactive-le plutôt (admin_set_disabled). (runner_has_account)")
	})

	t.Run("an unknown runner", func(t *testing.T) {
		announced(t, app, admin, "admin_delete_runner", map[string]any{"runner": "Zoé"}, "Coureur inconnu : « Zoé ». Les coureurs du groupe : Admin, Alice, Bob, Sam.")
		announced(t, app, admin, "admin_delete_runner", map[string]any{"runner": " "}, "Il manque le coureur (runner)")
	})

}

func TestAdmin_SetRole(t *testing.T) {
	app, fx, admin := adminApp(t)
	role := func(user *core.Record) string {
		t.Helper()
		return storedRecord(t, app, "users", user.Id).GetString("role")
	}

	t.Run("the only admin removes their own role: asked, then the site's refusal", func(t *testing.T) {
		args := map[string]any{"runner": "Admin", "role": "member"}
		token, message, details := asked(t, callTool(t, app, admin, "admin_set_role", args))
		mentions(t, message, details, "Ton compte passerait d'admin à membre", "les outils admin_… disparaîtraient de cet assistant")
		failsWith(t, callTool(t, app, admin, "admin_set_role", with(args, token)), "admin_set_role", "Il doit toujours rester au moins un admin. (last_admin)")
		if got := role(fx.Admin); got != "admin" {
			t.Errorf("the admin's role is %q", got)
		}
	})

	t.Run("Bob made an admin, once the person agrees", func(t *testing.T) {
		args := map[string]any{"runner": "bob", "role": "admin"}
		var message string
		var details []string
		writesNothing(t, app, func() {
			_, message, details = asked(t, callTool(t, app, admin, "admin_set_role", args))
		})
		mentions(t, message, details, "Le compte de Bob passerait de membre à admin", "gérer les membres",
			"Les assistants qui ont un jeton de ce compte auraient aussi les outils admin_… dès leur requête suivante.")
		updates := accountUpdates(t, app)
		result := confirmAndCall(t, app, admin, "admin_set_role", args)
		if got := role(fx.Bob); got != "admin" {
			t.Errorf("Bob's role is %q", got)
		}
		sentOnly(t, *updates, "role")
		assertJSON(t, map[string]any{"runner": result.Structured["runner"], "role": result.Structured["role"]}, map[string]any{"runner": runnerRef(fx.BobRunner), "role": "admin"})
	})

	t.Run("a role that is already the one: nothing to change", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, admin, "admin_set_role", map[string]any{"runner": "Bob", "role": "admin"}))
			if summary := summaryOfResult(result); !strings.HasPrefix(summary, "Rien à changer") {
				t.Errorf("the summary is %q", summary)
			}
		})
	})

	t.Run("a runner without an account", func(t *testing.T) {
		announced(t, app, admin, "admin_set_role", map[string]any{"runner": "Sam", "role": "admin"}, "Sam n'a pas de compte.")
	})

	t.Run("the admin removes their own role, another admin being there: the admin tools are gone at the next request", func(t *testing.T) {
		result := confirmAndCall(t, app, admin, "admin_set_role", map[string]any{"runner": "Admin", "role": "member"})
		if summary := summaryOfResult(result); !strings.Contains(summary, "admin_") {
			t.Errorf("the summary %q does not say that the admin tools are gone", summary)
		}
		if got := role(fx.Admin); got != "member" {
			t.Errorf("the admin's role is %q", got)
		}
		if hasAdminTools(t, app, admin) {
			t.Error("the token still lists the admin tools")
		}
	})
}

func TestAdmin_SetDisabled(t *testing.T) {
	app, fx, admin := adminApp(t)
	bob := newToken(t, app, fx.Bob)
	disabled := func(user *core.Record) bool {
		t.Helper()
		return storedRecord(t, app, "users", user.Id).GetBool("disabled")
	}

	t.Run("Bob disabled, once the person agrees: his token is refused at its next call", func(t *testing.T) {
		args := map[string]any{"runner": "Bob", "disabled": true}
		var message string
		var details []string
		writesNothing(t, app, func() {
			_, message, details = asked(t, callTool(t, app, admin, "admin_set_disabled", args))
		})
		mentions(t, message, details, "Le compte de Bob serait désactivé", "Bob ne pourrait plus se connecter",
			"ses sessions ouvertes seraient fermées", "ses jetons d'assistant (MCP) supprimés")
		rpc(t, app, bearer(bob), http.StatusOK, "tools/list", nil)

		updates := accountUpdates(t, app)
		result := confirmAndCall(t, app, admin, "admin_set_disabled", args)
		if !disabled(fx.Bob) {
			t.Fatal("Bob is not disabled")
		}
		sentOnly(t, *updates, "disabled")
		if result.Structured["disabled"] != true {
			t.Errorf("the answer says disabled %v", result.Structured["disabled"])
		}
		rpc(t, app, bearer(bob), http.StatusUnauthorized, "tools/list", nil)
	})

	t.Run("an account already disabled: nothing to change", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, admin, "admin_set_disabled", map[string]any{"runner": "Bob", "disabled": true}))
			if summary := summaryOfResult(result); !strings.HasPrefix(summary, "Rien à changer") {
				t.Errorf("the summary is %q", summary)
			}
		})
	})

	t.Run("Bob enabled again: written at once", func(t *testing.T) {
		result := isDone(t, callTool(t, app, admin, "admin_set_disabled", map[string]any{"runner": "Bob", "disabled": false}))
		if disabled(fx.Bob) {
			t.Error("Bob is still disabled")
		}
		if summary := summaryOfResult(result); !strings.Contains(summary, "réactivé") {
			t.Errorf("the summary is %q", summary)
		}
		// The token that the disabling deleted does not come back.
		rpc(t, app, bearer(bob), http.StatusUnauthorized, "tools/list", nil)
	})

	t.Run("a runner without an account", func(t *testing.T) {
		announced(t, app, admin, "admin_set_disabled", map[string]any{"runner": "Sam", "disabled": true}, "Sam n'a pas de compte.")
	})

	t.Run("the only admin disables their own account: asked, then the site's refusal", func(t *testing.T) {
		args := map[string]any{"runner": "Admin", "disabled": true}
		token, _, _ := asked(t, callTool(t, app, admin, "admin_set_disabled", args))
		failsWith(t, callTool(t, app, admin, "admin_set_disabled", with(args, token)), "admin_set_disabled", "(last_admin)")
		if disabled(fx.Admin) {
			t.Error("the only admin is disabled")
		}
	})

	t.Run("the admin disables their own account, another admin being there: this call is the last", func(t *testing.T) {
		update(t, app, fx.Alice, map[string]any{"role": "admin"})
		args := map[string]any{"runner": "Admin", "disabled": true}
		_, message, details := asked(t, callTool(t, app, admin, "admin_set_disabled", args))
		mentions(t, message, details, "C'est ton propre compte", "cet appel sera son dernier")
		result := confirmAndCall(t, app, admin, "admin_set_disabled", args)
		if summary := summaryOfResult(result); !strings.Contains(summary, "ce jeton ne marche plus") {
			t.Errorf("the summary %q does not say that this token no longer works", summary)
		}
		rpc(t, app, bearer(admin), http.StatusUnauthorized, "tools/list", nil)
	})
}
