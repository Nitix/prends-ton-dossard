package invitations_test

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	"courses/server/invitations"
	"courses/server/testutil"
)

// markSuperAdmin makes Bob an ordinary admin and marks the fixture's Admin super
// admin, as the command does.
func markSuperAdmin(t testing.TB, app core.App, fx testutil.Fixture) {
	t.Helper()
	for _, change := range []struct {
		user         *core.Record
		field, value any
	}{{fx.Bob, "role", "admin"}, {fx.Admin, "super_admin", true}} {
		record, err := app.FindRecordById("users", change.user.Id)
		if err != nil {
			t.Fatal(err)
		}
		record.Set(change.field.(string), change.value)
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
}

// resetsOf counts the reset links of a runner.
func resetsOf(t testing.TB, app core.App, runner *core.Record) int64 {
	t.Helper()
	n, err := app.CountRecords("invitations", dbx.HashExp{"runner": runner.Id, "kind": string(invitations.KindReset)})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// Nobody but the super admin makes a reset link for their account: whoever
// opens one chooses its password.
func TestCreate_ResetOfSuperAdmin(t *testing.T) {
	t.Run("refused to another admin", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		markSuperAdmin(t, app, fx)
		_, _, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.AdminRunner.Id, Kind: invitations.KindReset, CreatedBy: fx.Bob.Id})
		if got := apiError(t, err); got.Status != http.StatusForbidden || got.Data["code"] != apperr.CodeSuperAdminProtected {
			t.Errorf("err = %v, want a 403 %s", err, apperr.CodeSuperAdminProtected)
		}
		if n := resetsOf(t, app, fx.AdminRunner); n != 0 {
			t.Errorf("%d reset links were written, want none", n)
		}
	})
	t.Run("refused without author", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		markSuperAdmin(t, app, fx)
		_, _, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.AdminRunner.Id, Kind: invitations.KindReset})
		if got := apiError(t, err); got.Status != http.StatusForbidden || got.Data["code"] != apperr.CodeSuperAdminProtected {
			t.Errorf("err = %v, want a 403 %s", err, apperr.CodeSuperAdminProtected)
		}
	})
	t.Run("made by the super admin for themself", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		markSuperAdmin(t, app, fx)
		token, _, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.AdminRunner.Id, Kind: invitations.KindReset, CreatedBy: fx.Admin.Id})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := invitations.Find(app, token); err != nil {
			t.Errorf("the super admin's own reset link does not work: %v", err)
		}
	})
	t.Run("an ordinary account is reset as before", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		markSuperAdmin(t, app, fx)
		token, _, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.AliceRunner.Id, Kind: invitations.KindReset, CreatedBy: fx.Bob.Id})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := invitations.Find(app, token); err != nil {
			t.Errorf("the reset link of Alice does not work: %v", err)
		}
	})
}

// A reset link of a super admin made by somebody else (before the mark was
// set, say) is not one: it would still choose their password.
func TestFind_ResetOfSuperAdminMadeByAnother(t *testing.T) {
	const token = "reset-token-of-the-super-admin"
	madeBy := func(author func(testutil.Fixture) string) func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			seed(t, app, fx.AdminRunner, invitations.KindReset, token, func(r *core.Record) { r.Set("created_by", author(fx)) })
		}
	}

	for _, c := range []struct {
		name   string
		author func(testutil.Fixture) string
		valid  bool
	}{
		{"made by another admin", func(fx testutil.Fixture) string { return fx.Bob.Id }, false},
		{"made by nobody", func(testutil.Fixture) string { return "" }, false},
		{"made by the super admin", func(fx testutil.Fixture) string { return fx.Admin.Id }, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			markSuperAdmin(t, app, fx)
			madeBy(c.author)(t, app, fx)

			_, _, err := invitations.Find(app, token)
			if c.valid {
				if err != nil {
					t.Errorf("Find: %v, want the link", err)
				}
				return
			}
			if got := apiError(t, err); got.Status != http.StatusNotFound || got.Data["code"] != apperr.CodeInvitationInvalid {
				t.Errorf("Find: err = %v, want a 404 %s", err, apperr.CodeInvitationInvalid)
			}
			_, err = invitations.Accept(app, token, invitations.AcceptInput{Password: "a-new-password-1", PasswordConfirm: "a-new-password-1"})
			if got := apiError(t, err); got.Status != http.StatusNotFound || got.Data["code"] != apperr.CodeInvitationInvalid {
				t.Errorf("Accept: err = %v, want a 404 %s", err, apperr.CodeInvitationInvalid)
			}
			admin, err := app.FindRecordById("users", fx.Admin.Id)
			if err != nil {
				t.Fatal(err)
			}
			if !admin.ValidatePassword(testutil.Password) {
				t.Error("the password of the super admin changed")
			}
		})
	}
}

// The route answers the refusal with its code, for the members page.
func TestInvitations_CreateResetOfSuperAdmin(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "another admin cannot make a reset link for the super admin",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { markSuperAdmin(t, app, fx) },
			As:     "bob",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/app/invitations" },
			Body: func(fx testutil.Fixture) string {
				return `{"runnerId":"` + fx.AdminRunner.Id + `","kind":"reset"}`
			},
			Status:      http.StatusForbidden,
			Contains:    []string{`"code":"super_admin_protected"`},
			NotContains: []string{"/invitation/", "admin@example.test"},
		},
	})
}
