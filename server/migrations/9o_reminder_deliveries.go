package migrations

import (
	"database/sql"
	"errors"
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upReminderDeliveries, downReminderDeliveries)
}

// upReminderDeliveries creates the record of the reminders that were sent, one
// row for each person, event, kind of reminder and opening instant.
//
//   - The unique index is what stops a reminder from going twice: the scheduler
//     inserts the row first, and a reminder whose row is refused is already done,
//     even when two programs run at once.
//   - opening_at is the instant of the opening (RFC 3339, UTC), so that an
//     opening that is moved is another row, and its reminders go again.
//   - delivered is how many devices took the message.
//   - A row goes with its account or its event (cascade). The scheduler deletes
//     the rows older than 60 days.
//   - All the rules are null: only the reminders package reads and writes it.
func upReminderDeliveries(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}

	c := core.NewBaseCollection("reminder_deliveries")
	c.Fields.Add(
		cascade(required(relation("user", users))),
		cascade(required(relation("event", events))),
		&core.SelectField{Name: "kind", Required: true, Values: []string{"day", "hour"}, MaxSelect: 1},
		&core.TextField{Name: "opening_at", Required: true},
		&core.NumberField{Name: "delivered", OnlyInt: true, Min: types.Pointer(0.0)},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_reminder_deliveries_once ON reminder_deliveries (user, event, kind, opening_at)",
		"CREATE INDEX idx_reminder_deliveries_created ON reminder_deliveries (created)",
	}
	_, err = saveCollection(app, withTimestamps(c))
	return err
}

// downReminderDeliveries drops the table, and what it remembers: the reminders
// that are still due would go again. What is already gone is not an error.
func downReminderDeliveries(app core.App) error {
	c, err := app.FindCollectionByNameOrId("reminder_deliveries")
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return err
	}
	if err := app.Delete(c); err != nil {
		return fmt.Errorf("%s: %w", c.Name, err)
	}
	return nil
}
