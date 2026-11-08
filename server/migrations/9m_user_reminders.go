package migrations

import (
	"fmt"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upUserReminders, downUserReminders)
}

// userRemindersUpdateRule is the update rule of the accounts with the reminders
// in it: the one of the migration 9j, and one more condition on the admin's
// side. A member edits their own account, reminders included; an admin does not
// set the reminders of another account, any more than its skin: they are the
// choice of the person whose account it is.
var userRemindersUpdateRule = strings.TrimSuffix(userSkinUpdateRule, `)`) + ` && @request.body.reminders:isset = false)`

// upUserReminders adds `reminders` to the accounts: when the person wants to be
// warned before a registration opens, "day" (one day before) and "hour" (one
// hour before), at most the two. Empty, the default, means no reminder. The
// alarms of the calendar feed and the notifications follow this one choice.
//
// The update rule gains the one condition above, inside the parentheses of the
// admin's clause, which is the last one of userSkinUpdateRule.
func upUserReminders(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.Add(&core.SelectField{
		Name:      "reminders",
		Values:    []string{"day", "hour"},
		MaxSelect: 2,
	})
	users.UpdateRule = types.Pointer(userRemindersUpdateRule)
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}

// downUserReminders removes the field, with the choices that it holds, and puts
// the update rule back to the one of the migration 9j. The accounts stay.
func downUserReminders(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.RemoveByName("reminders")
	users.UpdateRule = types.Pointer(userSkinUpdateRule)
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}
