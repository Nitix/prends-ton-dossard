// Package cmd holds the commands of the server binary that manage its data
// from the command line: the first administrator, and the demo data.
package cmd

import (
	"errors"
	"fmt"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"

	"courses/server/config"
	"courses/server/invitations"
)

// NewBootstrapAdminCommand returns the command "bootstrap-admin <name>
// [--force]": it prints the link that lets the runner called name create the
// first admin account. Nothing else goes to stdout, since the end-to-end tests
// read the link from it.
func NewBootstrapAdminCommand(app core.App, cfg config.Config) *cobra.Command {
	var force bool

	command := &cobra.Command{
		Use:   "bootstrap-admin <name> [--force]",
		Short: "Print the link that creates an admin account for the runner called <name>",
		Long: "Print the link that lets the runner called <name> create an admin account.\n" +
			"The runner is created when it does not exist yet. The command refuses to\n" +
			"run when an admin already exists, unless --force is given.",
		Args:          cobra.ExactArgs(1),
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, args []string) error {
			if err := app.RunAllMigrations(); err != nil {
				return fmt.Errorf("applying the migrations: %w", err)
			}
			url, err := BootstrapAdmin(app, cfg.AppURL, args[0], force)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(command.OutOrStdout(), "Invitation URL: %s\n", url)
			return err
		},
	}
	command.Flags().BoolVar(&force, "force", false, "invite another admin although one already exists")
	return command
}

// BootstrapAdmin creates an invitation to an admin account for the runner
// called name, and returns its link on the site at appURL. The runner is
// created when there is none of that name, whatever the case. It refuses when
// an admin account exists, unless force is true, and when the runner already
// has an account. It writes nothing when it refuses or fails.
func BootstrapAdmin(app core.App, appURL, name string, force bool) (url string, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("the name of the runner is empty")
	}

	err = app.RunInTransaction(func(txApp core.App) error {
		if !force {
			admins, err := txApp.CountRecords("users", dbx.HashExp{"role": "admin"})
			if err != nil {
				return err
			}
			if admins > 0 {
				return errors.New("an admin already exists: use --force to invite another one")
			}
		}

		runner, err := findOrCreateRunner(txApp, name)
		if err != nil {
			return err
		}
		if runner.GetString("user") != "" {
			return fmt.Errorf("the runner %q already has an account", runner.GetString("name"))
		}

		token, _, err := invitations.Create(txApp, invitations.CreateInput{
			RunnerID: runner.Id,
			Kind:     invitations.KindInvite,
			Role:     "admin",
		})
		if err != nil {
			return fmt.Errorf("creating the invitation: %w", err)
		}
		url = invitations.URL(appURL, token)
		return nil
	})
	if err != nil {
		return "", err
	}
	return url, nil
}

// findOrCreateRunner returns the runner called name, compared as the unique
// index of the names does (letters of any case are the same), or a new one.
func findOrCreateRunner(app core.App, name string) (*core.Record, error) {
	found, err := app.FindAllRecords("runners",
		dbx.NewExp("[[name]] = {:name} COLLATE NOCASE", dbx.Params{"name": name}),
	)
	if err != nil {
		return nil, err
	}
	if len(found) > 0 {
		return found[0], nil
	}

	collection, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return nil, err
	}
	runner := core.NewRecord(collection)
	runner.Set("name", name)
	if err := app.Save(runner); err != nil {
		return nil, fmt.Errorf("creating the runner %q: %w", name, err)
	}
	return runner, nil
}
