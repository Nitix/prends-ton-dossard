package migrations

import (
	"errors"
	"fmt"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/dbutils"
)

func init() {
	pbmigrations.Register(upUsersEmailNoCase, downUsersEmailNoCase)
}

// upUsersEmailNoCase makes the email of an account ignore its capitals.
//
// PocketBase looks an email up case-insensitively, for the sign-in as for
// FindAuthRecordByEmail, only when the unique index of the email column has
// COLLATE NOCASE, and its default index has none: "Julie.M@gmail.com" could not
// sign in as "julie.m@gmail.com". The index keeps its name and its condition,
// and now also refuses two emails that differ only by their capitals (the
// application already refused them, see accounts.EmailTaken).
func upUsersEmailNoCase(app core.App) error {
	return setUsersEmailCollation(app, "NOCASE")
}

// downUsersEmailNoCase puts back the default index of PocketBase.
func downUsersEmailNoCase(app core.App) error {
	return setUsersEmailCollation(app, "")
}

// setUsersEmailCollation replaces the unique index of users.email with the same
// one, with the given collation (none when empty).
func setUsersEmailCollation(app core.App, collation string) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	for i, index := range users.Indexes {
		parsed := dbutils.ParseIndex(index)
		if !parsed.Unique || len(parsed.Columns) != 1 || !strings.EqualFold(parsed.Columns[0].Name, core.FieldNameEmail) {
			continue
		}
		column := "`" + core.FieldNameEmail + "`"
		if collation != "" {
			column += " COLLATE " + collation
		}
		users.Indexes[i] = fmt.Sprintf(
			"CREATE UNIQUE INDEX `%s` ON `%s` (%s) WHERE `%s` != ''",
			parsed.IndexName, users.Name, column, core.FieldNameEmail,
		)
		return app.Save(users)
	}
	return errors.New("users: the unique index of the email is missing")
}
