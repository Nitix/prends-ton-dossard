package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upRegistration, downRegistration)
}

// upRegistration adds the last day to register for an event and the price of
// a race. Neither is required, and the rules of the collections stay the ones
// of the migration 4: any member edits an event and its formats.
//
//   - events.registration_deadline is a YYYY-MM-DD text like the other days.
//     Its form, and that it is not after the first day of the event, are
//     checked by the hook of the events package: it is a rule on two fields.
//   - formats.price_eur is a number of euros, 0 or more. PocketBase stores a
//     number that is not set as 0, so a price of 0 is "no price". The hook
//     refuses more than two decimals.
func upRegistration(app core.App) error {
	zero := 0.0

	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.Add(&core.TextField{Name: "registration_deadline"})
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}

	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.Add(&core.NumberField{Name: "price_eur", Min: &zero})
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}

// downRegistration removes the two fields, and the values they hold.
func downRegistration(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.RemoveByName("registration_deadline")
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}

	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.RemoveByName("price_eur")
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}
