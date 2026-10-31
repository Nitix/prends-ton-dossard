package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upParticipationRules, downParticipationRules)
}

// A participation may be changed or deleted by an admin, by the runner it is
// about, and by anyone as long as that runner has not confirmed it (that is
// what lets a member keep the participations of a runner who has no account).
// The hooks of the participations package set "confirmed" and "added_by": the
// rules only decide who may write.
const participationOwnerClause = `(` + ruleAdmin + ` || runner.user = @request.auth.id || confirmed = false)`

// The rules of "participations" come with the hooks that maintain its
// invariants. Everyone signed in reads and adds; the runner and the one who
// added the participation never change, and the format stays in its event
// (a hook checks it).
var participationRules = collectionRules{
	list:   ruleSignedIn,
	view:   ruleSignedIn,
	create: ruleSignedIn,
	update: ruleSignedIn + ` && @request.body.runner:isset = false && @request.body.added_by:isset = false` +
		` && ` + participationOwnerClause,
	delete: ruleSignedIn + ` && ` + participationOwnerClause,
}

func upParticipationRules(app core.App) error {
	return setRules(app, "participations", participationRules)
}

// downParticipationRules puts every rule back to null, as the first migration
// left them.
func downParticipationRules(app core.App) error {
	return setRules(app, "participations", collectionRules{})
}
