// Package apperr builds the errors of the application. They carry a code,
// never a text: the front end shows its own message for each code.
package apperr

import (
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

// New returns an error that the API answers with that HTTP status and the body
// data {"code": code}. Its message is the code itself.
func New(status int, code string) error {
	err := router.NewApiError(status, code, nil)
	err.Message = code
	err.Data = map[string]any{"code": code}
	return err
}

// Field returns a validation error on one field, which the API answers with a
// 400 and the body data {"<field>": {"code": code}}.
func Field(field, code string) error {
	return validation.Errors{field: validation.NewError(code, code)}
}
