package accounts

import (
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
)

// RequireAdmin refuses, with the forbidden code, the callers that are not
// active admins. It is the one admin check of the routes: put it after
// apis.RequireAuth("users"), which is what makes e.Auth an account.
//
// A disabled admin is refused too, although disabling an account ends its
// sessions: the check does not rely on that.
func RequireAdmin(e *core.RequestEvent) error {
	if e.Auth == nil || !isActiveAdmin(e.Auth) {
		return apperr.New(http.StatusForbidden, apperr.CodeForbidden)
	}
	return e.Next()
}
