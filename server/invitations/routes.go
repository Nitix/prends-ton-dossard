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

	"courses/server/apperr"
	"courses/server/config"
)

// Register adds the routes of the invitations to app: creating and revoking
// one is for the admins, showing and accepting one is public (the token is the
// secret, and the rate limit rule of the settings slows down the guesses).
func Register(app core.App, cfg config.Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/app/invitations", createRoute(cfg)).Bind(apis.RequireAuth("users")).BindFunc(requireAdmin)
		e.Router.DELETE("/api/app/invitations/{id}", revokeRoute).Bind(apis.RequireAuth("users")).BindFunc(requireAdmin)
		e.Router.GET("/api/app/invitations/{token}", showRoute)
		e.Router.POST("/api/app/invitations/{token}/accept", acceptRoute)
		return e.Next()
	})
}

// requireAdmin refuses the callers that are not admins. It comes after
// RequireAuth, so e.Auth is an account.
func requireAdmin(e *core.RequestEvent) error {
	if e.Auth.GetString("role") != "admin" {
		return apperr.New(http.StatusForbidden, apperr.CodeForbidden)
	}
	return e.Next()
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

		return e.JSON(http.StatusOK, map[string]any{
			"url":       URL(cfg.AppURL, token),
			"expiresAt": inv.GetDateTime("expires_at").Time().UTC().Format(time.RFC3339),
		})
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

func showRoute(e *core.RequestEvent) error {
	inv, runner, err := Find(e.App, e.Request.PathValue("token"))
	if err != nil {
		return fail(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"runnerName": runner.GetString("name"),
		"kind":       inv.GetString("kind"),
	})
}

func acceptRoute(e *core.RequestEvent) error {
	var body struct {
		Email           string `json:"email"`
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	// A body that cannot be read leaves what is missing empty, which the checks
	// of Accept refuse.
	_ = e.BindBody(&body)

	user, err := Accept(e.App, e.Request.PathValue("token"), AcceptInput{
		Email:           body.Email,
		Password:        body.Password,
		PasswordConfirm: body.PasswordConfirm,
	})
	if err != nil {
		return fail(e, err)
	}

	return apis.RecordAuthResponse(e, user, "password", nil)
}
