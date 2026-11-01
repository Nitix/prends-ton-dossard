package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upTrustedProxy, downTrustedProxy)
}

// forwardedForHeader is the header that the reverse proxy in front of the
// program sets to the address of the client.
const forwardedForHeader = "X-Forwarded-For"

// upTrustedProxy makes PocketBase read the address of the client from
// X-Forwarded-For. Without it, RealIP is the address of the connection, and
// behind Caddy and the port that Docker publishes that is always the same: the
// whole group would share one rate limit bucket (see ourRateLimitRules) and a
// single abuser could lock the login and the invitations for everybody.
//
// This is safe only because the program is reachable only through the proxy:
// compose.yaml publishes its port on 127.0.0.1 only (HOST_PORT of .env, 8090
// by default), and Caddy overwrites the header it receives. UseLeftmostIP stays false: PocketBase then takes the
// rightmost address, the one that the proxy appended, so a header that a client
// sent along does not choose the bucket.
func upTrustedProxy(app core.App) error {
	settings := app.Settings()

	settings.TrustedProxy.Headers = []string{forwardedForHeader}
	settings.TrustedProxy.UseLeftmostIP = false

	return app.Save(settings)
}

// downTrustedProxy goes back to the PocketBase defaults: no trusted header.
func downTrustedProxy(app core.App) error {
	settings := app.Settings()

	settings.TrustedProxy.Headers = []string{}
	settings.TrustedProxy.UseLeftmostIP = false

	return app.Save(settings)
}
