package accounts

import (
	"errors"
	"net/http"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/ozzo-validation/v4/is"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
)

// registerEmailRoute adds POST /api/app/me/email. The email is changed at
// once, with no confirmation message: the application never sends any, and the
// current password is what proves the caller is the owner of the account.
func registerEmailRoute(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/app/me/email", changeEmail).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
}

func changeEmail(e *core.RequestEvent) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	// A body that cannot be read leaves what is missing empty, which the checks
	// below refuse.
	_ = e.BindBody(&body)

	account := e.Auth
	if !account.ValidatePassword(body.Password) {
		return apperr.New(http.StatusBadRequest, apperr.CodeWrongPassword)
	}

	// The format rule is the one of the email field, which does not check an
	// empty value.
	if body.Email == "" || is.EmailFormat.Validate(body.Email) != nil {
		return apperr.New(http.StatusBadRequest, apperr.CodeEmailInvalid)
	}

	// The sign-in looks the email up as it is written: two accounts that only
	// differ by their letters would be confusing, so the comparison ignores them.
	// The caller's own account does not count, which lets them change the case.
	taken, err := e.App.CountRecords("users",
		dbx.NewExp("LOWER([[email]]) = {:email}", dbx.Params{"email": strings.ToLower(body.Email)}),
		dbx.Not(dbx.HashExp{"id": account.Id}),
	)
	if err != nil {
		return e.InternalServerError("", err)
	}
	if taken > 0 {
		return apperr.New(http.StatusBadRequest, apperr.CodeEmailTaken)
	}

	account.SetEmail(body.Email)
	if err := e.App.Save(account); err != nil {
		// Another account took the email since the check above.
		var invalid validation.Errors
		if errors.As(err, &invalid) && invalid["email"] != nil {
			return apperr.New(http.StatusBadRequest, apperr.CodeEmailTaken)
		}
		return e.InternalServerError("", err)
	}

	// PocketBase renews the token key of an account whose email changes, so the
	// token that made this request is now refused. The response is therefore an
	// auth response, with a new token for the caller to keep. The method is empty:
	// this continues the session, it is not a sign-in (no MFA, no login alert).
	return apis.RecordAuthResponse(e, account, "", nil)
}
