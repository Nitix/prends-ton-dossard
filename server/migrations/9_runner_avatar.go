package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upRunnerAvatar, downRunnerAvatar)
}

// upRunnerAvatar adds the photo of a runner. The rules of "runners" stay the
// ones of the migration 4: the runner's own account and the admin may write
// the field, since it is an update of the record, and nobody else.
//
// The field is not protected. A protected file asks for a short-lived file
// token on every image, which the site would have to renew in each <img>; an
// unprotected one has a random name that cannot be guessed, and the site only
// shows it to signed-in members.
func upRunnerAvatar(app core.App) error {
	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}

	runners.Fields.Add(&core.FileField{
		Name:      "avatar",
		MaxSelect: 1,
		MaxSize:   5 << 20,
		MimeTypes: []string{"image/jpeg", "image/png", "image/webp"},
		// 96x96 for the chips and the lists, 256x256 for the profile.
		Thumbs:    []string{"96x96", "256x256"},
		Protected: false,
	})
	if err := app.Save(runners); err != nil {
		return fmt.Errorf("runners: %w", err)
	}
	return nil
}

// downRunnerAvatar removes the field. The photos already sent stay in the
// storage directory of PocketBase, unreferenced.
func downRunnerAvatar(app core.App) error {
	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}

	runners.Fields.RemoveByName("avatar")
	if err := app.Save(runners); err != nil {
		return fmt.Errorf("runners: %w", err)
	}
	return nil
}
