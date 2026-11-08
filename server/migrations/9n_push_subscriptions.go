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
	pbmigrations.Register(upPushSubscriptions, downPushSubscriptions)
}

// upPushSubscriptions creates the subscriptions to the notifications, one per
// device (a browser on a computer, a phone): what the push service of a browser
// gave the site, so that the site can write to that device.
//
//   - A subscription goes with its account (cascade). The push package keeps ten
//     per account, and removes those of a disabled account.
//   - The endpoint is unique: a device has one subscription, and when it changes
//     account it changes owner. It is the address of the device at the push
//     service, so only the push package reads it; the keys are hidden too, so
//     that no API response shows them (a superuser sees the hidden fields).
//   - lang is the language of the messages that this device gets: the one of the
//     page when it subscribed.
//   - label is what the settings page calls the device. last_success_at is the
//     last delivery that the push service accepted, and failures the deliveries
//     in a row that it did not.
//   - All the rules are null (the collection is created with them): only the
//     push package reads and writes the table, as for the tokens of the MCP.
func upPushSubscriptions(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	c := core.NewBaseCollection("push_subscriptions")
	c.Fields.Add(
		cascade(required(relation("user", users))),
		&core.TextField{Name: "endpoint", Required: true, Max: 1000},
		&core.TextField{Name: "p256dh", Required: true, Hidden: true},
		&core.TextField{Name: "auth", Required: true, Hidden: true},
		&core.SelectField{Name: "lang", Required: true, Values: []string{"fr", "en"}, MaxSelect: 1},
		&core.TextField{Name: "label", Max: 60},
		&core.DateField{Name: "last_success_at"},
		&core.NumberField{Name: "failures", OnlyInt: true, Min: types.Pointer(0.0)},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint)",
		"CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user)",
	}
	_, err = saveCollection(app, withTimestamps(c))
	return err
}

// downPushSubscriptions drops the table, and the subscriptions in it: the
// devices stop receiving, and subscribe again by themselves when the site is
// opened. What is already gone is not an error.
func downPushSubscriptions(app core.App) error {
	c, err := app.FindCollectionByNameOrId("push_subscriptions")
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
