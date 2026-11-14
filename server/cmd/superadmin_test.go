package cmd_test

import (
	"bytes"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/cmd"
	"courses/server/testutil"
)

// accountOf reads an account again from the database.
func accountOf(t testing.TB, app core.App, user *core.Record) *core.Record {
	t.Helper()
	record, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

// superAdmins counts the accounts that have the mark.
func superAdmins(t testing.TB, app core.App) int64 {
	t.Helper()
	n, err := app.CountRecords("users", dbx.HashExp{"super_admin": true})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSetSuperAdmin_Marks(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// The name is compared as the unique index of the names does: any case.
	name, err := cmd.SetSuperAdmin(app, "  admin ", true)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Admin" {
		t.Errorf("name = %q, want the name of the runner, Admin", name)
	}
	a := accountOf(t, app, fx.Admin)
	if !a.GetBool("super_admin") || a.GetString("role") != "admin" || a.GetBool("disabled") {
		t.Errorf("account = super_admin %v, role %q, disabled %v; want a marked, active admin",
			a.GetBool("super_admin"), a.GetString("role"), a.GetBool("disabled"))
	}
}

// The command gives back the rights of an account that lost them: it is how the
// owner of the site gets them back.
func TestSetSuperAdmin_RestoresADemotedDisabledAccount(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := accountOf(t, app, fx.Alice)
	alice.Set("disabled", true)
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}

	if _, err := cmd.SetSuperAdmin(app, "Alice", true); err != nil {
		t.Fatal(err)
	}
	a := accountOf(t, app, fx.Alice)
	if !a.GetBool("super_admin") || a.GetString("role") != "admin" || a.GetBool("disabled") {
		t.Errorf("account = super_admin %v, role %q, disabled %v; want a marked, active admin",
			a.GetBool("super_admin"), a.GetString("role"), a.GetBool("disabled"))
	}
}

func TestSetSuperAdmin_Remove(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	if _, err := cmd.SetSuperAdmin(app, "Admin", true); err != nil {
		t.Fatal(err)
	}

	name, err := cmd.SetSuperAdmin(app, "Admin", false)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Admin" {
		t.Errorf("name = %q, want Admin", name)
	}
	a := accountOf(t, app, fx.Admin)
	if a.GetBool("super_admin") || a.GetString("role") != "admin" || a.GetBool("disabled") {
		t.Errorf("account = super_admin %v, role %q, disabled %v; want an active admin without the mark",
			a.GetBool("super_admin"), a.GetString("role"), a.GetBool("disabled"))
	}
}

func TestSetSuperAdmin_Refuses(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)

	for name, runner := range map[string]string{
		"an empty name":            "  ",
		"an unknown runner":        "Nobody",
		"a runner without account": "Sam",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := cmd.SetSuperAdmin(app, runner, true)
			if err == nil {
				t.Fatal("want an error")
			}
			if strings.Contains(err.Error(), "@") {
				t.Errorf("the error %q must not carry an email", err)
			}
			if n := superAdmins(t, app); n != 0 {
				t.Errorf("%d accounts were marked, want none", n)
			}
		})
	}
}

func TestSuperAdminCommand_Output(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)

	run := func(t *testing.T, args ...string) (string, error) {
		t.Helper()
		command := cmd.NewSuperAdminCommand(app)
		var out bytes.Buffer
		command.SetOut(&out)
		command.SetArgs(args)
		err := command.Execute()
		return out.String(), err
	}

	if out, err := run(t, "Admin"); err != nil || out != "Admin is now a super admin.\n" {
		t.Errorf("super-admin Admin: stdout %q, error %v; want %q", out, err, "Admin is now a super admin.\n")
	}
	if out, err := run(t, "Admin", "--remove"); err != nil || out != "Admin is no longer a super admin.\n" {
		t.Errorf("super-admin Admin --remove: stdout %q, error %v; want %q", out, err, "Admin is no longer a super admin.\n")
	}
	for name, args := range map[string][]string{"no name": {}, "two names": {"Admin", "Alice"}, "no account": {"Sam"}} {
		t.Run(name, func(t *testing.T) {
			out, err := run(t, args...)
			if err == nil {
				t.Fatal("want an error")
			}
			if out != "" {
				t.Errorf("stdout = %q, want nothing", out)
			}
		})
	}
}
