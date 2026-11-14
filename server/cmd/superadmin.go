package cmd

import (
	"errors"
	"fmt"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

// NewSuperAdminCommand returns the command "super-admin <name> [--remove]": it
// marks the account of the runner called name super admin, an account that the
// other admins cannot change, or takes the mark away with --remove. It prints
// one line with the name of the runner, never an email.
func NewSuperAdminCommand(app core.App) *cobra.Command {
	var remove bool

	command := &cobra.Command{
		Use:   "super-admin <name> [--remove]",
		Short: "Mark the account of the runner called <name> super admin, or remove the mark",
		Long: "Mark the account of the runner called <name> super admin: the other admins\n" +
			"can no longer change its role, disable it, reset it, delete its passkeys, or\n" +
			"rename its runner or change its photo. The account also becomes an active\n" +
			"admin, which gives back rights that were lost. With --remove, only the mark\n" +
			"goes: the role and the state of the account stay as they are.",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			if err := app.RunAllMigrations(); err != nil {
				return fmt.Errorf("applying the migrations: %w", err)
			}
			name, err := SetSuperAdmin(app, args[0], !remove)
			if err != nil {
				return err
			}
			line := "%s is now a super admin.\n"
			if remove {
				line = "%s is no longer a super admin.\n"
			}
			_, err = fmt.Fprintf(command.OutOrStdout(), line, name)
			return err
		},
	}
	command.Flags().BoolVar(&remove, "remove", false, "remove the mark; the role and the state of the account do not change")
	return command
}

// SetSuperAdmin marks the account of the runner called name super admin (on),
// which also makes it an active admin, or takes the mark away (off), which
// changes nothing else. It returns the name of the runner as it is stored. The
// runner is found as the unique index of the names compares them (any case),
// and never created. It refuses a runner that does not exist or has no account,
// and writes nothing when it refuses or fails.
func SetSuperAdmin(app core.App, name string, on bool) (runnerName string, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("the name of the runner is empty")
	}

	err = app.RunInTransaction(func(txApp core.App) error {
		found, err := txApp.FindAllRecords("runners",
			dbx.NewExp("[[name]] = {:name} COLLATE NOCASE", dbx.Params{"name": name}),
		)
		if err != nil {
			return err
		}
		if len(found) == 0 {
			return fmt.Errorf("no runner is called %q", name)
		}
		runner := found[0]
		runnerName = runner.GetString("name")
		if runner.GetString("user") == "" {
			return fmt.Errorf("the runner %q has no account", runnerName)
		}

		account, err := txApp.FindRecordById("users", runner.GetString("user"))
		if err != nil {
			return fmt.Errorf("the account of the runner %q: %w", runnerName, err)
		}
		account.Set("super_admin", on)
		if on {
			account.Set("role", "admin")
			account.Set("disabled", false)
		}
		return txApp.Save(account)
	})
	if err != nil {
		return "", err
	}
	return runnerName, nil
}
