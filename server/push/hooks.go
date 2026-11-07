package push

import (
	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// maxPerAccount is how many devices an account has at most.
const maxPerAccount = 10

// registerHooks keeps the invariants of the subscriptions. They are model
// hooks, so that they also protect the writes that do not come from the routes.
func registerHooks(app core.App) {
	// An account has at most ten devices: the one that makes the eleventh
	// replaces the oldest, by the date of its last update. This is after the
	// save, so that the new one is counted, and a device that moves to this
	// account (an update) counts as well.
	keepNewest := func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return dropOldest(e.App, e.Record)
	}
	app.OnRecordCreate("push_subscriptions").BindFunc(keepNewest)
	app.OnRecordUpdate("push_subscriptions").BindFunc(keepNewest)

	// A disabled account has no device: they go with the update that disables it,
	// and stay gone when the account is enabled again, as its sessions do. A
	// device that was made while the account was disabled goes at the next update.
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if !e.Record.GetBool("disabled") {
			return nil
		}
		return deleteDevicesOf(e.App, e.Record.Id)
	})
}

// dropOldest deletes the devices of the owner of kept beyond the ten newest,
// never kept itself.
func dropOldest(app core.App, kept *core.Record) error {
	owner := dbx.HashExp{"user": kept.GetString("user")}
	count, err := app.CountRecords("push_subscriptions", owner)
	if err != nil || count <= maxPerAccount {
		return err
	}
	var oldest []*core.Record
	err = app.RecordQuery("push_subscriptions").
		AndWhere(owner).
		AndWhere(dbx.Not(dbx.HashExp{"id": kept.Id})).
		OrderBy("updated ASC", "id ASC").
		Limit(count - maxPerAccount).
		All(&oldest)
	if err != nil {
		return err
	}
	for _, device := range oldest {
		if err := app.Delete(device); err != nil {
			return err
		}
	}
	return nil
}

// deleteDevicesOf deletes every device of the account.
func deleteDevicesOf(app core.App, userID string) error {
	devices, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		return err
	}
	for _, device := range devices {
		if err := app.Delete(device); err != nil {
			return err
		}
	}
	return nil
}
