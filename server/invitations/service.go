package invitations

import (
	"database/sql"
	"errors"
	"net/http"
	"time"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/accounts"
	"courses/server/apperr"
)

// Kind says what an invitation is for.
type Kind string

const (
	// KindInvite lets a runner without account create one.
	KindInvite Kind = "invite"
	// KindReset lets the owner of an account choose a new password.
	KindReset Kind = "reset"
)

const (
	validity          = 7 * 24 * time.Hour
	minPasswordLength = 10
)

// CreateInput is what Create needs to make an invitation.
type CreateInput struct {
	RunnerID string
	Kind     Kind
	// Role is the role of the account an "invite" creates: "member" (when
	// empty) or "admin". A "reset" has none.
	Role string
	// CreatedBy is the id of the account that asks, or empty when nobody does
	// (the command line).
	CreatedBy string
}

// Create makes an invitation valid for seven days and returns its token, which
// only exists here: the database keeps its hash. The pending invitations of the
// same kind for the same runner are deleted first, so that only the last link
// works.
func Create(app core.App, in CreateInput) (token string, inv *core.Record, err error) {
	err = app.RunInTransaction(func(txApp core.App) error {
		runner, err := txApp.FindRecordById("runners", in.RunnerID)
		if errors.Is(err, sql.ErrNoRows) {
			return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}
		if err != nil {
			return err
		}

		// Only a runner without account can join, and only an account can get a
		// new password.
		hasAccount := runner.GetString("user") != ""
		switch in.Kind {
		case KindInvite:
			if hasAccount {
				return apperr.New(http.StatusBadRequest, apperr.CodeInvitationKindMismatch)
			}
		case KindReset:
			if !hasAccount {
				return apperr.New(http.StatusBadRequest, apperr.CodeInvitationKindMismatch)
			}
		default:
			return apperr.New(http.StatusBadRequest, apperr.CodeInvitationKindMismatch)
		}

		pending, err := txApp.FindAllRecords("invitations",
			dbx.HashExp{"runner": runner.Id, "kind": string(in.Kind)},
			dbx.NewExp("COALESCE([[used_at]], '') = ''"),
		)
		if err != nil {
			return err
		}
		for _, old := range pending {
			if err := txApp.Delete(old); err != nil {
				return err
			}
		}

		var hash string
		token, hash, err = NewToken()
		if err != nil {
			return err
		}
		collection, err := txApp.FindCollectionByNameOrId("invitations")
		if err != nil {
			return err
		}
		inv = core.NewRecord(collection)
		inv.Set("runner", runner.Id)
		inv.Set("kind", string(in.Kind))
		if in.Kind == KindInvite {
			role := in.Role
			if role == "" {
				role = "member"
			}
			inv.Set("role", role)
		}
		inv.Set("token_hash", hash)
		inv.Set("expires_at", time.Now().UTC().Add(validity))
		inv.Set("created_by", in.CreatedBy)
		return txApp.Save(inv)
	})
	if err != nil {
		return "", nil, err
	}
	return token, inv, nil
}

// Find returns the invitation of token and the runner it is for. It answers a
// 404 invitation_invalid when there is none, or when it cannot be used any
// more: it is expired, it was used, or the runner no longer fits its kind (an
// invitation to a runner that has an account since, a reset of a runner
// without).
func Find(app core.App, token string) (inv, runner *core.Record, err error) {
	invalid := apperr.New(http.StatusNotFound, apperr.CodeInvitationInvalid)

	inv, err = app.FindFirstRecordByData("invitations", "token_hash", Hash(token))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, invalid
	}
	if err != nil {
		return nil, nil, err
	}
	if !inv.GetDateTime("used_at").IsZero() || !inv.GetDateTime("expires_at").Time().After(time.Now()) {
		return nil, nil, invalid
	}

	runner, err = app.FindRecordById("runners", inv.GetString("runner"))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, invalid
	}
	if err != nil {
		return nil, nil, err
	}
	hasAccount := runner.GetString("user") != ""
	switch Kind(inv.GetString("kind")) {
	case KindInvite:
		if hasAccount {
			return nil, nil, invalid
		}
	case KindReset:
		if !hasAccount {
			return nil, nil, invalid
		}
	default:
		return nil, nil, invalid
	}
	return inv, runner, nil
}

// AcceptInput is what the person sends to use an invitation. The email is only
// read for an "invite".
type AcceptInput struct {
	Email, Password, PasswordConfirm string
}

// Accept uses the invitation of token, and returns the account it created (an
// "invite") or changed (a "reset"). It runs in one transaction, and reads the
// invitation again inside it: nothing is written unless everything is, and one
// token cannot be used twice.
//
// It refuses with, in this order: invitation_invalid (404), password_too_short,
// password_mismatch, then for an "invite" email_invalid and email_taken, or for
// a "reset" of a disabled account account_disabled (403).
func Accept(app core.App, token string, in AcceptInput) (user *core.Record, err error) {
	err = app.RunInTransaction(func(txApp core.App) error {
		inv, runner, err := Find(txApp, token)
		if err != nil {
			return err
		}

		if utf8.RuneCountInString(in.Password) < minPasswordLength {
			return apperr.New(http.StatusBadRequest, apperr.CodePasswordTooShort)
		}
		if in.Password != in.PasswordConfirm {
			return apperr.New(http.StatusBadRequest, apperr.CodePasswordMismatch)
		}

		if Kind(inv.GetString("kind")) == KindInvite {
			user, err = createAccount(txApp, inv, runner, in)
		} else {
			user, err = resetPassword(txApp, runner, in.Password)
		}
		if err != nil {
			return err
		}

		inv.Set("used_at", time.Now().UTC())
		return txApp.Save(inv)
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

// createAccount creates the account of an "invite" and links the runner to it.
func createAccount(app core.App, inv, runner *core.Record, in AcceptInput) (*core.Record, error) {
	email := accounts.NormalizeEmail(in.Email)
	if !accounts.ValidEmail(email) {
		return nil, apperr.New(http.StatusBadRequest, apperr.CodeEmailInvalid)
	}
	taken, err := accounts.EmailTaken(app, email, "")
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, apperr.New(http.StatusBadRequest, apperr.CodeEmailTaken)
	}

	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, err
	}
	user := core.NewRecord(collection)
	user.SetEmail(email)
	user.SetPassword(in.Password)
	// Nothing is ever sent to this email, and the invitation is what proved who
	// the person is.
	user.SetVerified(true)
	user.Set("role", inv.GetString("role"))
	if err := app.Save(user); err != nil {
		return nil, err
	}

	runner.Set("user", user.Id)
	if err := app.Save(runner); err != nil {
		return nil, err
	}
	return user, nil
}

// resetPassword gives the account of the runner a new password, which ends its
// sessions.
func resetPassword(app core.App, runner *core.Record, password string) (*core.Record, error) {
	user, err := app.FindRecordById("users", runner.GetString("user"))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperr.New(http.StatusNotFound, apperr.CodeInvitationInvalid)
	}
	if err != nil {
		return nil, err
	}
	// The response is a session, which the sign-in rule refuses to a disabled
	// account: refuse before changing anything.
	if user.GetBool("disabled") {
		return nil, apperr.New(http.StatusForbidden, apperr.CodeAccountDisabled)
	}

	user.SetPassword(password)
	// PocketBase already does it when the password changes, but the end of the
	// sessions is the point of a reset: do not depend on it.
	user.RefreshTokenKey()
	if err := app.Save(user); err != nil {
		return nil, err
	}
	return user, nil
}
