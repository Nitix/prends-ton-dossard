package admin

import (
	"errors"
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/accounts"
	"courses/server/apperr"
)

// Register adds the admin routes to app: POST /api/app/admin/merge-events and
// POST /api/app/admin/merge-formats. Both take the body
// {"keepId", "mergeId", "dryRun"} and answer the MergeResult. They are for the
// admins, whatever the front end shows.
func Register(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		group := e.Router.Group("/api/app/admin")
		group.Bind(apis.RequireAuth("users"))
		group.BindFunc(accounts.RequireAdmin)
		group.POST("/merge-events", mergeRoute(MergeEvents))
		group.POST("/merge-formats", mergeRoute(MergeFormats))
		return e.Next()
	})
}

// mergeRoute answers a merge request with the result of merge.
func mergeRoute(merge func(app core.App, keepID, mergeID string, dryRun bool) (MergeResult, error)) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			KeepID  string `json:"keepId"`
			MergeID string `json:"mergeId"`
			DryRun  bool   `json:"dryRun"`
		}
		// A body that cannot be read names no record, and must not be run on
		// what could be read of it: a dryRun that is not a boolean would
		// otherwise become a real merge. The codes have no "bad request", and
		// the records that the body names are what is missing.
		if err := e.BindBody(&body); err != nil {
			return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}

		result, err := merge(e.App, body.KeepID, body.MergeID, body.DryRun)
		if err != nil {
			// The errors that carry a code are the ones of the caller, and any
			// other one is the server's.
			var apiErr *router.ApiError
			if errors.As(err, &apiErr) {
				return err
			}
			return e.InternalServerError("", err)
		}
		return e.JSON(http.StatusOK, result)
	}
}
