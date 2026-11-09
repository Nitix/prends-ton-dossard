package invitations

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/accounts"
	"courses/server/apperr"
	"courses/server/config"
	"courses/server/wording"
)

// Register adds the routes of the invitations to app: creating and revoking
// one is for the admins, looking one up and accepting one is public (the token
// is the secret, and the rate limit rule of the settings, which covers every
// path under /api/app/invitations/, slows down the guesses).
//
// The token is in the body of the two public routes, never in their path or
// query: PocketBase writes the URL of every request to its request log, which
// would keep a working token in clear text for days.
func Register(app core.App, cfg config.Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/app/invitations", createRoute(cfg)).Bind(apis.RequireAuth("users")).BindFunc(accounts.RequireAdmin)
		e.Router.DELETE("/api/app/invitations/{id}", revokeRoute).Bind(apis.RequireAuth("users")).BindFunc(accounts.RequireAdmin)
		e.Router.POST("/api/app/invitations/lookup", lookupRoute)
		e.Router.POST("/api/app/invitations/accept", acceptRoute)
		return e.Next()
	})
}

// fail returns err as the response: the errors that carry a code or a field are
// the ones of the caller, and any other one is the server's.
func fail(e *core.RequestEvent, err error) error {
	var apiErr *router.ApiError
	var invalid validation.Errors
	if errors.As(err, &apiErr) || errors.As(err, &invalid) {
		return err
	}
	return e.InternalServerError("", err)
}

func createRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			RunnerID string `json:"runnerId"`
			Kind     Kind   `json:"kind"`
			Role     string `json:"role"`
			Lang     string `json:"lang"`
		}
		// A body that cannot be read leaves what is missing empty, and no runner
		// has an empty id.
		_ = e.BindBody(&body)

		token, inv, err := Create(e.App, CreateInput{
			RunnerID:  body.RunnerID,
			Kind:      body.Kind,
			Role:      body.Role,
			CreatedBy: e.Auth.Id,
		})
		if err != nil {
			return fail(e, err)
		}

		out := map[string]any{
			"url":       URL(cfg.AppURL, token),
			"expiresAt": inv.GetDateTime("expires_at").Time().UTC().Format(time.RFC3339),
		}
		if body.Kind == KindInvite {
			// Written now, from the preview of the moment: the admin sends this text.
			w := wording.Of(body.Lang)
			preview, err := ComputePreview(e.App, inv.GetString("runner"), e.Auth.Id, ParisDay(now()), w)
			if err != nil {
				return e.InternalServerError("", err)
			}
			runner, err := e.App.FindRecordById("runners", inv.GetString("runner"))
			if err != nil {
				return e.InternalServerError("", err)
			}
			m := wording.InvitationMessage{Invitee: runner.GetString("name"), Total: preview.Upcoming.Total, URL: out["url"].(string)}
			if preview.InvitedBy != nil {
				m.Inviter = *preview.InvitedBy
			}
			if m.Total > 0 {
				first := preview.Upcoming.Races[0]
				m.NextEvent, m.NextDay, m.NextMonthOnly = first.Event, first.Day, first.MonthOnly
			}
			out["message"] = w.InvitationMessage(m)
		}
		return e.JSON(http.StatusOK, out)
	}
}

func revokeRoute(e *core.RequestEvent) error {
	inv, err := e.App.FindRecordById("invitations", e.Request.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
	}
	if err != nil {
		return e.InternalServerError("", err)
	}
	// A used invitation is a trace of what happened: there is nothing to revoke.
	if !inv.GetDateTime("used_at").IsZero() {
		return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
	}

	if err := e.App.Delete(inv); err != nil {
		return e.InternalServerError("", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func lookupRoute(e *core.RequestEvent) error {
	var body struct {
		Token string `json:"token"`
		Lang  string `json:"lang"`
	}
	// A body that cannot be read leaves the token empty, which no invitation has.
	_ = e.BindBody(&body)

	inv, runner, err := Find(e.App, body.Token)
	if err != nil {
		return fail(e, err)
	}
	if Kind(inv.GetString("kind")) != KindInvite {
		return e.JSON(http.StatusOK, map[string]any{
			"runnerName": runner.GetString("name"),
			"kind":       inv.GetString("kind"),
		})
	}

	preview, err := ComputePreview(e.App, runner.Id, inv.GetString("created_by"), ParisDay(now()), wording.Of(body.Lang))
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, struct {
		RunnerName string `json:"runnerName"`
		Kind       string `json:"kind"`
		Preview
	}{runner.GetString("name"), inv.GetString("kind"), preview})
}

func acceptRoute(e *core.RequestEvent) error {
	var body struct {
		Token           string `json:"token"`
		Email           string `json:"email"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	// A body that cannot be read leaves what is missing empty, which the checks
	// of Accept refuse (first of all the token, which no invitation has empty).
	_ = e.BindBody(&body)

	user, err := Accept(e.App, body.Token, AcceptInput{
		Email:           body.Email,
		Password:        body.Password,
		PasswordConfirm: body.PasswordConfirm,
	})
	if err != nil {
		return fail(e, err)
	}

	return apis.RecordAuthResponse(e, user, "password", nil)
}
