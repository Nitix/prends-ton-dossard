// Package admin holds what only the admins do: merging the duplicates that
// the members create when they each add the same event or the same format.
package admin

import (
	"database/sql"
	"errors"
	"net/http"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/events"
)

// MergeResult is what a merge did, or would do for a dry run.
type MergeResult struct {
	// MovedFormats is the number of formats that went to the kept event.
	MovedFormats int `json:"movedFormats"`
	// MovedParticipations is the number of participations that went to the kept
	// format, that are carried by the formats that went to the kept event, or
	// that have no format and went to the kept event.
	MovedParticipations int `json:"movedParticipations"`
	// DroppedParticipations is the number of participations that were deleted
	// because their runner was already on the kept format, or already in the
	// kept event for participations that have no format. Of the two
	// participations of a runner on a format, or in an event with no format,
	// the one that winner picks stays.
	DroppedParticipations int `json:"droppedParticipations"`
	// ClearedFormatDates is the number of formats that lost their date, which
	// was outside the range of the kept event.
	ClearedFormatDates int `json:"clearedFormatDates"`
}

// MergeEvents moves the formats of the event mergeID to the event keepID, then
// deletes the event mergeID. A moved format whose date is outside the range of
// the kept event loses its date, since a format stays inside its event.
//
// The participations follow, in this order:
//
//  1. Those on a moved format go to the kept event with their format (they
//     count as moved).
//  2. Those of the kept event that have no format are deleted when their runner
//     now is on a moved format: the runner has chosen (they count as dropped).
//  3. Those of the merged event that have no format are deleted when the runner
//     already is in the kept event on a format, kept or moved (they count as
//     dropped). When the runner has one with no format in the kept event too,
//     the one that winner picks stays, as in MergeFormats: the one of the
//     kept event, which then is the one dropped, or the one of the merged event,
//     which replaces it and goes to the kept event (one dropped and one moved).
//     Otherwise they go to the kept event (they count as moved).
//
// With dryRun it only computes the result: nothing is written. Otherwise
// everything is written in one transaction, so a failure leaves the database as
// it was.
func MergeEvents(app core.App, keepID, mergeID string, dryRun bool) (MergeResult, error) {
	if keepID == mergeID {
		return MergeResult{}, apperr.New(http.StatusBadRequest, apperr.CodeMergeSameRecord)
	}

	var result MergeResult
	err := app.RunInTransaction(func(tx core.App) error {
		keep, err := find(tx, "events", keepID)
		if err != nil {
			return err
		}
		merged, err := find(tx, "events", mergeID)
		if err != nil {
			return err
		}
		formats, err := tx.FindAllRecords("formats", dbx.HashExp{"event": merged.Id})
		if err != nil {
			return err
		}

		// What decides which participations stay is read before anything is
		// written, so that a dry run and a real run count the same.
		inKeptEvent, err := tx.FindAllRecords("participations", dbx.HashExp{"event": keep.Id})
		if err != nil {
			return err
		}
		mergedUndecided, err := tx.FindAllRecords("participations",
			dbx.HashExp{"event": merged.Id, "format": ""})
		if err != nil {
			return err
		}
		// The runners that are on a format of the kept event (a moved format is
		// added below), and the participations of the kept event that have no
		// format, in order and by runner: a runner has at most one of them.
		onFormat := make(map[string]bool, len(inKeptEvent))
		var keptUndecided []*core.Record
		keptUndecidedOf := make(map[string]*core.Record)
		for _, p := range inKeptEvent {
			if p.GetString("format") == "" {
				keptUndecided = append(keptUndecided, p)
				keptUndecidedOf[p.GetString("runner")] = p
				continue
			}
			onFormat[p.GetString("runner")] = true
		}
		// The runners that are on a moved format.
		movedRunners := make(map[string]bool)

		start, end := keep.GetString("start_date"), keep.GetString("end_date")
		for _, format := range formats {
			carried, err := tx.FindAllRecords("participations", dbx.HashExp{"format": format.Id})
			if err != nil {
				return err
			}
			result.MovedFormats++
			result.MovedParticipations += len(carried)
			for _, p := range carried {
				onFormat[p.GetString("runner")] = true
				movedRunners[p.GetString("runner")] = true
			}

			format.Set("event", keep.Id)
			// The date is cleared before the save: the validation of a format
			// refuses a date outside the range of its event.
			if day := format.GetString("date"); day != "" && !events.InRange(day, start, end) {
				format.Set("date", "")
				result.ClearedFormatDates++
			}
			if dryRun {
				continue
			}
			if err := tx.Save(format); err != nil {
				return err
			}
			// A participation is in the event of its format, which the
			// validation checks: it follows the format, once that one has
			// moved.
			for _, p := range carried {
				p.Set("event", keep.Id)
				if err := tx.Save(p); err != nil {
					return err
				}
			}
		}

		// A participation of the kept event that has no format is replaced by
		// the one on a moved format.
		for _, p := range keptUndecided {
			if !movedRunners[p.GetString("runner")] {
				continue
			}
			result.DroppedParticipations++
			if dryRun {
				continue
			}
			if err := tx.Delete(p); err != nil {
				return err
			}
		}

		// A participation of the merged event that has no format is dropped when
		// its runner already is in the kept event on a format (kept or moved):
		// the runner has chosen. When the runner has one with no format in the
		// kept event as well, the one that winner picks stays, as in a merge of
		// formats: the one of the merged event replaces the one of the kept event
		// when it wins (the two count as one moved and one dropped). The deletions
		// come before the moves: the unique index on (runner, event) with no
		// format allows one of them in the kept event.
		var moving []*core.Record
		for _, p := range mergedUndecided {
			runner := p.GetString("runner")
			if onFormat[runner] {
				result.DroppedParticipations++
				if dryRun {
					continue
				}
				if err := tx.Delete(p); err != nil {
					return err
				}
				continue
			}
			if duplicate := keptUndecidedOf[runner]; duplicate != nil {
				result.DroppedParticipations++
				if winner(duplicate, p) != p {
					// The one of the kept event stays, this one goes.
					if !dryRun {
						if err := tx.Delete(p); err != nil {
							return err
						}
					}
					continue
				}
				if !dryRun {
					if err := tx.Delete(duplicate); err != nil {
						return err
					}
				}
			}
			result.MovedParticipations++
			moving = append(moving, p)
		}
		if dryRun {
			return nil
		}
		for _, p := range moving {
			p.Set("event", keep.Id)
			if err := tx.Save(p); err != nil {
				return err
			}
		}

		// Nothing is left to cascade to: the formats have moved, and the
		// participations of the event are in the kept event or deleted.
		return tx.Delete(merged)
	})
	if err != nil {
		// What the counters hold is not what happened: the transaction is undone.
		return MergeResult{}, err
	}
	return result, nil
}

// MergeFormats moves the participations of the format mergeID to the format
// keepID, then deletes the format mergeID. Both formats must be of the same
// event.
//
// A runner who is on both formats keeps one participation, the one that winner
// picks, and the other is deleted: it counts as dropped. When it is the
// participation of mergeID that wins, it moves to keepID and counts as moved,
// and the one that was on keepID is the one dropped. A participation keeps its
// own values (status, confirmed, added_by) whichever way it goes.
//
// With dryRun it only computes the result: nothing is written. Otherwise
// everything is written in one transaction, so a failure leaves the database as
// it was.
func MergeFormats(app core.App, keepID, mergeID string, dryRun bool) (MergeResult, error) {
	if keepID == mergeID {
		return MergeResult{}, apperr.New(http.StatusBadRequest, apperr.CodeMergeSameRecord)
	}

	var result MergeResult
	err := app.RunInTransaction(func(tx core.App) error {
		keep, err := find(tx, "formats", keepID)
		if err != nil {
			return err
		}
		merged, err := find(tx, "formats", mergeID)
		if err != nil {
			return err
		}
		if keep.GetString("event") != merged.GetString("event") {
			return apperr.New(http.StatusBadRequest, apperr.CodeMergeFormatsDifferentEvents)
		}

		kept, err := tx.FindAllRecords("participations", dbx.HashExp{"format": keep.Id})
		if err != nil {
			return err
		}
		keptByRunner := make(map[string]*core.Record, len(kept))
		for _, p := range kept {
			keptByRunner[p.GetString("runner")] = p
		}
		moving, err := tx.FindAllRecords("participations", dbx.HashExp{"format": merged.Id})
		if err != nil {
			return err
		}

		for _, p := range moving {
			// A runner is at most once on a format, so a participation drops at
			// most one other.
			duplicate := keptByRunner[p.GetString("runner")]
			if duplicate != nil {
				result.DroppedParticipations++
				if winner(duplicate, p) != p {
					// The kept one stays, this one goes.
					if !dryRun {
						if err := tx.Delete(p); err != nil {
							return err
						}
					}
					continue
				}
				// The unique index on (runner, format) allows one of them on the
				// kept format: the loser has to go before the winner arrives.
				if !dryRun {
					if err := tx.Delete(duplicate); err != nil {
						return err
					}
				}
			}

			result.MovedParticipations++
			if dryRun {
				continue
			}
			p.Set("format", keep.Id)
			if err := tx.Save(p); err != nil {
				return err
			}
		}
		if dryRun {
			return nil
		}
		// Nothing is left to cascade to: every participation has moved or gone.
		return tx.Delete(merged)
	})
	if err != nil {
		// What the counters hold is not what happened: the transaction is undone.
		return MergeResult{}, err
	}
	return result, nil
}

// statusRank orders the statuses of a participation by how far the runner got:
// a status that is not here is the lowest.
var statusRank = map[string]int{
	"interested": 0,
	"registered": 1,
	"finished":   2,
	"dnf":        2,
	"dns":        2,
}

// winner returns the participation of a runner that is kept when the runner
// is on both formats of a merge of formats, or in both events with no format
// in a merge of events. A confirmed participation wins, since the runner
// said it is true. Otherwise the one that is the furthest along wins, and keep
// wins a tie.
func winner(keep, other *core.Record) *core.Record {
	if keepConfirmed, otherConfirmed := keep.GetBool("confirmed"), other.GetBool("confirmed"); keepConfirmed != otherConfirmed {
		if otherConfirmed {
			return other
		}
		return keep
	}
	if statusRank[other.GetString("status")] > statusRank[keep.GetString("status")] {
		return other
	}
	return keep
}

// find returns the record of the collection that has that id, or the not found
// error of the API.
func find(app core.App, collection, id string) (*core.Record, error) {
	record, err := app.FindRecordById(collection, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperr.New(http.StatusNotFound, apperr.CodeNotFound)
	}
	if err != nil {
		return nil, err
	}
	return record, nil
}
