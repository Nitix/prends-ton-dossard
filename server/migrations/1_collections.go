package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upCollections, downCollections)
}

// createdCollections lists the collections created by this migration, in
// dependency order (a collection only points at the ones before it).
var createdCollections = []string{
	"runners", "race_types", "events", "formats", "participations", "invitations", "passkeys",
}

// All the new collections keep every API rule at null (superuser only): the
// access rules are added later, together with the tests that cover them.
func upCollections(app core.App) error {
	if err := alterUsers(app); err != nil {
		return fmt.Errorf("users: %w", err)
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	// Each builder returns the collection to save. Relations need the id of
	// the collection they point at, which only exists once it has been saved,
	// so the builders are called one after the other.
	runners, err := saveCollection(app, newRunners(users))
	if err != nil {
		return err
	}
	raceTypes, err := saveCollection(app, newRaceTypes())
	if err != nil {
		return err
	}
	events, err := saveCollection(app, newEvents(runners))
	if err != nil {
		return err
	}
	formats, err := saveCollection(app, newFormats(events, raceTypes))
	if err != nil {
		return err
	}
	if _, err := saveCollection(app, newParticipations(runners, formats)); err != nil {
		return err
	}
	if _, err := saveCollection(app, newInvitations(runners, users)); err != nil {
		return err
	}
	_, err = saveCollection(app, newPasskeys(users))
	return err
}

func downCollections(app core.App) error {
	for i := len(createdCollections) - 1; i >= 0; i-- {
		c, err := app.FindCollectionByNameOrId(createdCollections[i])
		if err != nil {
			continue // already gone
		}
		if err := app.Delete(c); err != nil {
			return fmt.Errorf("%s: %w", c.Name, err)
		}
	}
	return revertUsers(app)
}

func saveCollection(app core.App, c *core.Collection) (*core.Collection, error) {
	if err := app.Save(c); err != nil {
		return nil, fmt.Errorf("%s: %w", c.Name, err)
	}
	return c, nil
}

// withTimestamps adds the created and updated system dates, which PocketBase
// does not add on its own to a new collection.
func withTimestamps(c *core.Collection) *core.Collection {
	c.Fields.Add(
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	return c
}

func relation(name string, to *core.Collection) *core.RelationField {
	return &core.RelationField{Name: name, CollectionId: to.Id, MaxSelect: 1}
}

// required returns r as a required relation.
func required(r *core.RelationField) *core.RelationField {
	r.Required = true
	return r
}

// cascade returns r so that deleting the record it points at deletes its owner.
func cascade(r *core.RelationField) *core.RelationField {
	r.CascadeDelete = true
	return r
}

// alterUsers turns the default PocketBase "users" collection into ours.
func alterUsers(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	users.Fields.RemoveByName("name")
	users.Fields.RemoveByName("avatar")
	// The OAuth2 field mapping pointed at the two fields removed above.
	users.OAuth2.MappedFields = core.OAuth2KnownFields{}

	// PocketBase has no default value for a select, so the role is required:
	// whoever creates a user (invitation, command line) states it.
	users.Fields.Add(
		&core.SelectField{Name: "role", Values: []string{"member", "admin"}, MaxSelect: 1, Required: true},
		&core.BoolField{Name: "disabled"},
	)
	users.Fields.GetByName("password").(*core.PasswordField).Min = 10

	// Sign in by email and password only.
	users.AuthRule = types.Pointer("disabled = false")
	users.PasswordAuth.Enabled = true
	users.PasswordAuth.IdentityFields = []string{core.FieldNameEmail}
	users.OAuth2.Enabled = false
	users.OTP.Enabled = false
	users.MFA.Enabled = false
	// The new-device alert is an email, and the application never sends any.
	users.AuthAlert.Enabled = false

	// No sign-up through the API, and no access until the rules are defined.
	users.ListRule = nil
	users.ViewRule = nil
	users.CreateRule = nil
	users.UpdateRule = nil
	users.DeleteRule = nil

	return app.Save(users)
}

// revertUsers puts the "users" collection back to the PocketBase default.
func revertUsers(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	users.Fields.RemoveByName("role")
	users.Fields.RemoveByName("disabled")
	users.Fields.Add(
		&core.TextField{Name: "name", Max: 255},
		&core.FileField{
			Name:      "avatar",
			MaxSelect: 1,
			MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
		},
	)
	users.OAuth2.MappedFields.Name = "name"
	users.OAuth2.MappedFields.AvatarURL = "avatar"
	users.Fields.GetByName("password").(*core.PasswordField).Min = 8

	users.AuthRule = types.Pointer("")
	users.AuthAlert.Enabled = true
	ownerRule := "id = @request.auth.id"
	users.ListRule = types.Pointer(ownerRule)
	users.ViewRule = types.Pointer(ownerRule)
	users.CreateRule = types.Pointer("")
	users.UpdateRule = types.Pointer(ownerRule)
	users.DeleteRule = types.Pointer(ownerRule)

	return app.Save(users)
}

func newRunners(users *core.Collection) *core.Collection {
	c := core.NewBaseCollection("runners")
	c.Fields.Add(
		&core.TextField{Name: "name", Required: true, Min: 1, Max: 50},
		// Empty until the person gets an account.
		relation("user", users),
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_runners_name ON runners (name COLLATE NOCASE)",
		"CREATE UNIQUE INDEX idx_runners_user ON runners (user) WHERE user != ''",
	}
	return withTimestamps(c)
}

func newRaceTypes() *core.Collection {
	c := core.NewBaseCollection("race_types")
	c.Fields.Add(
		&core.TextField{Name: "label", Required: true},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_race_types_label ON race_types (label COLLATE NOCASE)",
	}
	return withTimestamps(c)
}

func newEvents(runners *core.Collection) *core.Collection {
	c := core.NewBaseCollection("events")
	c.Fields.Add(
		&core.TextField{Name: "name", Required: true, Min: 1, Max: 120},
		&core.TextField{Name: "location", Required: true},
		// Dates are plain calendar days stored as YYYY-MM-DD text. Their
		// format and order are checked by a hook, which reports error codes.
		&core.TextField{Name: "start_date", Required: true},
		&core.TextField{Name: "end_date"},
		&core.URLField{Name: "registration_url"},
		&core.TextField{Name: "notes"},
		// Set by the server from the signed-in user; empty for a superuser.
		relation("created_by", runners),
	)
	return withTimestamps(c)
}

func newFormats(events, raceTypes *core.Collection) *core.Collection {
	zero := 0.0
	one := 1.0
	c := core.NewBaseCollection("formats")
	c.Fields.Add(
		cascade(required(relation("event", events))),
		&core.TextField{Name: "name"},
		// No cascade: a race type in use cannot be deleted.
		required(relation("race_type", raceTypes)),
		// A zero number is how PocketBase stores "not set", and the number
		// constraints only apply to non-zero values. The rule that one of the
		// three measures must be set is enforced by a hook.
		&core.NumberField{Name: "distance_km", Min: &zero},
		&core.NumberField{Name: "duration_min", Min: &one, OnlyInt: true},
		&core.NumberField{Name: "time_limit_min", Min: &one, OnlyInt: true},
		&core.NumberField{Name: "elevation_gain_m", Min: &zero, OnlyInt: true},
		&core.TextField{Name: "date"},
	)
	return withTimestamps(c)
}

func newParticipations(runners, formats *core.Collection) *core.Collection {
	c := core.NewBaseCollection("participations")
	c.Fields.Add(
		required(relation("runner", runners)),
		cascade(required(relation("format", formats))),
		&core.SelectField{
			Name:      "status",
			Values:    []string{"interested", "registered", "finished", "dnf", "dns"},
			MaxSelect: 1,
			Required:  true,
		},
		// Set by the server from the signed-in user.
		relation("added_by", runners),
		&core.BoolField{Name: "confirmed"},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_participations_runner_format ON participations (runner, format)",
	}
	return withTimestamps(c)
}

func newInvitations(runners, users *core.Collection) *core.Collection {
	c := core.NewBaseCollection("invitations")
	c.Fields.Add(
		cascade(required(relation("runner", runners))),
		&core.SelectField{Name: "kind", Values: []string{"invite", "reset"}, MaxSelect: 1, Required: true},
		// Only meaningful for an "invite".
		&core.SelectField{Name: "role", Values: []string{"member", "admin"}, MaxSelect: 1},
		// Only the SHA-256 of the token is stored, never the token itself.
		&core.TextField{Name: "token_hash", Required: true, Hidden: true},
		&core.DateField{Name: "expires_at", Required: true},
		&core.DateField{Name: "used_at"},
		// Empty when created from the command line.
		relation("created_by", users),
	)
	return withTimestamps(c)
}

func newPasskeys(users *core.Collection) *core.Collection {
	c := core.NewBaseCollection("passkeys")
	c.Fields.Add(
		cascade(required(relation("user", users))),
		&core.TextField{Name: "name", Required: true},
		&core.TextField{Name: "credential_id", Required: true},
		// The WebAuthn credential serialized by go-webauthn.
		&core.JSONField{Name: "credential", Required: true, Hidden: true},
		&core.DateField{Name: "last_used_at"},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE UNIQUE INDEX idx_passkeys_credential_id ON passkeys (credential_id)",
	}
	return withTimestamps(c)
}
