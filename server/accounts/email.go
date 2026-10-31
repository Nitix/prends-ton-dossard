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

// ValidEmail reports whether email can be the email of an account. The format
// rule is the one of the email field, which does not check an empty value: an
// account needs one.
func ValidEmail(email string) bool {
	return email != "" && is.EmailFormat.Validate(email) == nil
}

// EmailTaken reports whether an account other than the one of exceptID (none
// when empty) already has email. The sign-in looks the email up as it is
// written: two accounts that only differ by their letters would be confusing,
// so the comparison ignores them.
func EmailTaken(app core.App, email, exceptID string) (bool, error) {
	conditions := []dbx.Expression{
		dbx.NewExp("LOWER([[email]]) = {:email}", dbx.Params{"email": strings.ToLower(email)}),
	}
	if exceptID != "" {
		conditions = append(conditions, dbx.Not(dbx.HashExp{"id": exceptID}))
	}
	n, err := app.CountRecords("users", conditions...)
	return n > 0, err
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

	if !ValidEmail(body.Email) {
		return apperr.New(http.StatusBadRequest, apperr.CodeEmailInvalid)
	}

	// The caller's own account does not count, which lets them change the case.
	taken, err := EmailTaken(e.App, body.Email, account.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	if taken {
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
