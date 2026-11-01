package migrations

import (
	"errors"
	"fmt"
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upSupporter, downSupporter)
}

// statusSupporter is the status of a runner who comes to cheer at an event
// without running a race. It goes with a participation to the event only: the
// hook of the participations package refuses it on a format.
const statusSupporter = "supporter"

// upSupporter adds the status "supporter" to the participations. The rules, the
// indexes and the other statuses stay as they are.
func upSupporter(app core.App) error {
	participations, status, err := participationStatus(app)
	if err != nil {
		return err
	}
	if !slices.Contains(status.Values, statusSupporter) {
		status.Values = append(status.Values, statusSupporter)
	}
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}
	return nil
}

// downSupporter takes the status away. A supporter becomes interested in the
// event, which is the closest status of the v1.1: the rows are updated first,
// since a status that is not in the field fails the validation of the
// collection for the participations that hold it.
func downSupporter(app core.App) error {
	if _, err := app.DB().NewQuery(
		"UPDATE participations SET status = 'interested' WHERE status = 'supporter'",
	).Execute(); err != nil {
		return fmt.Errorf("participations: turning the supporters into interested runners: %w", err)
	}

	participations, status, err := participationStatus(app)
	if err != nil {
		return err
	}
	status.Values = slices.DeleteFunc(status.Values, func(value string) bool { return value == statusSupporter })
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}
	return nil
}

// participationStatus returns the collection of the participations, and its
// field status.
func participationStatus(app core.App) (*core.Collection, *core.SelectField, error) {
	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		return nil, nil, err
	}
	status, ok := participations.Fields.GetByName("status").(*core.SelectField)
	if !ok {
		return nil, nil, errors.New("participations: the field status is not a select")
	}
	return participations, status, nil
}
