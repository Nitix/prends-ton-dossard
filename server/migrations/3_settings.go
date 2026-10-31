package migrations

import (
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// ourRateLimitRules are the rate limit rules added on top of the PocketBase
// defaults, for the routes that take a secret from an anonymous caller.
var ourRateLimitRules = []core.RateLimitRule{
	{Label: "/api/app/invitations/", MaxRequests: 10, Duration: 60},
	{Label: "/api/app/passkeys/login/", MaxRequests: 20, Duration: 60},
}

func init() {
	pbmigrations.Register(upSettings, downSettings)
}

func upSettings(app core.App) error {
	settings := app.Settings()

	settings.Backups.Cron = "0 3 * * *"
	settings.Backups.CronMaxKeep = 7

	settings.Batch.Enabled = true
	settings.Batch.MaxRequests = 50

	// PocketBase applies the first matching prefix rule, and its default
	// "/api/" rule matches every route: ours must come before it.
	settings.RateLimits.Enabled = true
	settings.RateLimits.Rules = append(slices.Clone(ourRateLimitRules), settings.RateLimits.Rules...)

	return app.Save(settings)
}

// downSettings goes back to the PocketBase defaults.
func downSettings(app core.App) error {
	settings := app.Settings()

	settings.Backups.Cron = ""
	settings.Backups.CronMaxKeep = 3

	settings.Batch.Enabled = false

	settings.RateLimits.Enabled = false
	settings.RateLimits.Rules = slices.DeleteFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool {
		return slices.ContainsFunc(ourRateLimitRules, func(ours core.RateLimitRule) bool { return ours.Label == r.Label })
	})

	return app.Save(settings)
}
