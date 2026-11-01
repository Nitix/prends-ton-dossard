package migrations

import (
	"errors"
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upParticipationEvent, downParticipationEvent)
}

// participationRulesV11 are the rules of "participations" once a participation
// is in an event of its own: the ones of the v1, and the event, which only the
// code of the application changes (the merge of two events), never the API.
var participationRulesV11 = func() collectionRules {
	rules := participationRules
	rules.update += ` && @request.body.event:isset = false`
	return rules
}()

// The two unique indexes of "participations" replace the one of the v1 on the
// runner and the format. A runner is at most once on a format, and at most
// once in an event without a format; the two partial indexes do not meet, so
// that a runner can be on several formats of an event.
const (
	indexRunnerFormat   = "CREATE UNIQUE INDEX idx_participations_runner_format ON participations (runner, format) WHERE format != ''"
	indexRunnerEvent    = "CREATE UNIQUE INDEX idx_participations_runner_event ON participations (runner, event) WHERE format = ''"
	indexRunnerFormatV1 = "CREATE UNIQUE INDEX idx_participations_runner_format ON participations (runner, format)"
)

// upParticipationEvent gives each participation an event, and makes its format
// optional: a participation without a format is for the event only.
//
// The participations that exist take the event of their format. One whose
// format does not exist has none to take: it is deleted.
func upParticipationEvent(app core.App) error {
	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		return err
	}
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	format, ok := participations.Fields.GetByName("format").(*core.RelationField)
	if !ok {
		return errors.New("participations: the field format is not a relation")
	}

	participations.Fields.Add(cascade(required(relation("event", events))))
	// The format stays deleted with its participations.
	format.Required = false
	participations.Indexes = types.JSONArray[string]{indexRunnerFormat, indexRunnerEvent}
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}

	// A participation whose format does not exist (a hand edit, a restore of an
	// inconsistent database) is invisible in the v1, which reads the
	// participations through their format, and it has no event to take: the
	// subquery below would give NULL, which the NOT NULL column refuses and
	// fails the whole migration. It cannot be repaired, so it is deleted.
	if _, err := app.DB().NewQuery(
		"DELETE FROM participations WHERE format != '' AND NOT EXISTS (SELECT 1 FROM formats WHERE formats.id = participations.format)",
	).Execute(); err != nil {
		return fmt.Errorf("participations: deleting the ones whose format is gone: %w", err)
	}

	if _, err := app.DB().NewQuery(
		"UPDATE participations SET event = (SELECT formats.event FROM formats WHERE formats.id = participations.format)" +
			" WHERE event = '' AND format != ''",
	).Execute(); err != nil {
		return fmt.Errorf("participations: filling the event: %w", err)
	}

	return setRules(app, "participations", participationRulesV11)
}

// downParticipationEvent puts back the schema and the rules of the v1. The
// participations without a format do not exist in it: they are deleted.
func downParticipationEvent(app core.App) error {
	// The rule of the v1 does not mention the event, which is about to go.
	if err := setRules(app, "participations", participationRules); err != nil {
		return err
	}

	if _, err := app.DB().NewQuery("DELETE FROM participations WHERE format = ''").Execute(); err != nil {
		return fmt.Errorf("participations: deleting the ones without a format: %w", err)
	}

	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		return err
	}
	format, ok := participations.Fields.GetByName("format").(*core.RelationField)
	if !ok {
		return errors.New("participations: the field format is not a relation")
	}

	format.Required = true
	participations.Fields.RemoveByName("event")
	participations.Indexes = types.JSONArray[string]{indexRunnerFormatV1}
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}
	return nil
}
