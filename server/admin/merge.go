// Package admin holds what only the admins do: merging the duplicates that
// the members create when they each add the same event or the same format.
package admin

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"regexp"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

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
	// MovedComments is the number of comments of the merged event that went to
	// the kept event. A merge of formats moves none.
	MovedComments int `json:"movedComments"`
	// MovedOffers is the number of offers (cars and lodgings) of the merged
	// event that went to the kept event, the places that people took in them
	// following. A merge of formats moves none.
	MovedOffers int `json:"movedOffers"`
}

// MergeEvents moves the formats, the comments and the offers of the event
// mergeID to the event keepID, then deletes the event mergeID. A moved format
// whose date is outside the range of the kept event loses its date, since a
// format stays inside its event.
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
// The comments of the merged event all go to the kept event, as they are: only
// their event changes, so they keep their author, their text and their dates,
// the one of their last change included (they are not shown as edited).
//
// The offers of the merged event go to the kept event as they are too, and the
// places in them follow, since a place points at its offer. The rule that a
// runner has one offer of each kind per event is for the writes: after a merge a
// runner may be in two cars of the kept event, and an admin cleans up.
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

		// The comments move as they are, and none is dropped: counting them
		// does not depend on what is written below, so a dry run counts them
		// too.
		commentCount, err := tx.CountRecords("comments", dbx.HashExp{"event": merged.Id})
		if err != nil {
			return err
		}
		result.MovedComments = int(commentCount)
		// The offers too, and for the same reason.
		offerCount, err := tx.CountRecords("offers", dbx.HashExp{"event": merged.Id})
		if err != nil {
			return err
		}
		result.MovedOffers = int(offerCount)

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
			// refuses a date outside the range of its event, and any date on a race
			// known by its month only.
			if day := format.GetString("date"); day != "" && (events.MonthOnly(keep) || !events.InRange(day, start, end)) {
				format.Set("date", "")
				result.ClearedFormatDates++
			}
			// A race known by its month has no start time for a format either. A
			// time on a race with days stays: it is a time of the day, not a day.
			if events.MonthOnly(keep) {
				format.Set("start_time", "")
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

		// The comments move before the event is deleted: deleting it would
		// delete them with it. One statement, not a save of each: a save sets
		// the date of the last change, and the front shows a comment whose
		// "created" and "updated" differ as edited, which a merge is not. Only
		// the event changes, so nothing of a comment needs validating again.
		if _, err := tx.DB().NewQuery("UPDATE comments SET event = {:keep} WHERE event = {:merged}").
			Bind(dbx.Params{"keep": keep.Id, "merged": merged.Id}).Execute(); err != nil {
			return err
		}

		// The offers move the same way, for the same reason: the dates of their
		// last change stay. The places are not touched: they point at their
		// offer, which stays the same.
		if _, err := tx.DB().NewQuery("UPDATE offers SET event = {:keep} WHERE event = {:merged}").
			Bind(dbx.Params{"keep": keep.Id, "merged": merged.Id}).Execute(); err != nil {
			return err
		}

		// Nothing is left to cascade to: the formats, the comments and the
		// offers have moved, and the participations of the event are in the kept
		// event or deleted.
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
// The route of mergeID (its link and its GPX track) goes to keepID where keepID
// has none (see carryRoute). Its price and its other fields are not carried.
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
			// Not validated: merging two copies of one race moves what the
			// runners have acquired, and the status "finished" or "dnf" on a
			// race that has not started (its day moved later since, or the kept
			// copy has a later day) would be refused by validateStarted, after
			// a dry run that said it works. Nothing else that the validation
			// guards changes here: the status and the result stay, both formats
			// are of the same event (checked above), and the runner is on the
			// kept format once, which the unique index of the database enforces,
			// not the validation.
			if err := tx.SaveNoValidate(p); err != nil {
				return err
			}
		}
		if dryRun {
			return nil
		}
		if err := carryRoute(tx, keep, merged); err != nil {
			return err
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

// carryRoute gives keep the route of merged, which is deleted with its record
// otherwise: the link (route_url) and the GPX track, each one only when keep has
// none. Two members adding the same event is the usual reason for a merge of
// formats, and the one who sent the track must not have to look for the file
// again. When both have a track, or a link, keep's stays: nothing tells which
// one is better.
//
// The track is a file in the storage, which goes with the record that holds it:
// it is copied under keep. It is read now, before the transaction ends and the
// files of merged are deleted. A track that is not in the storage any more is
// left out, so that the admin can still merge.
func carryRoute(app core.App, keep, merged *core.Record) error {
	changed := false
	if link := merged.GetString("route_url"); link != "" && keep.GetString("route_url") == "" {
		keep.Set("route_url", link)
		changed = true
	}
	if name := merged.GetString("gpx"); name != "" && keep.GetString("gpx") == "" {
		file, err := copyOfFile(app, merged, name)
		if err != nil {
			return err
		}
		if file != nil {
			keep.Set("gpx", file)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return app.Save(keep)
}

// storedNameSuffix is the random part that PocketBase adds before the extension
// of a file it stores: ten characters of lowercase letters and digits.
var storedNameSuffix = regexp.MustCompile(`_[a-z0-9]{10}(\.[^.]*)?$`)

// copyOfFile returns a new file, ready to be set on another record, with the
// content of the file called name that record holds. It returns nil when the
// file is not in the storage.
func copyOfFile(app core.App, record *core.Record, name string) (*filesystem.File, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + name)
	if errors.Is(err, filesystem.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	// PocketBase adds a random part to the name of a file: without cutting the
	// one that is there, the copy would carry two of them.
	return filesystem.NewFileFromBytes(content, storedNameSuffix.ReplaceAllString(name, "$1"))
}

// statusRank orders the statuses of a participation by how far the runner got:
// a status that is not here is the lowest. A supporter is as low as an
// interested runner: neither is further along than the other.
var statusRank = map[string]int{
	"supporter":  0,
	"interested": 0,
	"registered": 1,
	"finished":   2,
	"dnf":        2,
	"dns":        2,
}

// winner returns the participation of a runner that is kept when the runner
// is on both formats of a merge of formats, or in both events with no format
// in a merge of events. A confirmed participation wins, since the runner
// said it is true. Otherwise the one that is the furthest along wins. When
// both are still level, the one that has a result wins, since the runner
// entered it after the race and it would be lost with the other one: finished,
// dnf and dns are as far along as each other, so a tie of statuses is common
// once results are entered. keep wins what is left: a tie, whether both or
// neither have a result.
func winner(keep, other *core.Record) *core.Record {
	if keepConfirmed, otherConfirmed := keep.GetBool("confirmed"), other.GetBool("confirmed"); keepConfirmed != otherConfirmed {
		if otherConfirmed {
			return other
		}
		return keep
	}
	if keepRank, otherRank := statusRank[keep.GetString("status")], statusRank[other.GetString("status")]; keepRank != otherRank {
		if otherRank > keepRank {
			return other
		}
		return keep
	}
	if hasResult(other) && !hasResult(keep) {
		return other
	}
	return keep
}

// hasResult reports whether the participation has any part of a result: a
// time, a rank, the number of people ranked, or a note.
func hasResult(p *core.Record) bool {
	return p.GetInt("finish_time_s") > 0 || p.GetInt("rank") > 0 || p.GetInt("rank_of") > 0 ||
		p.GetString("result_note") != ""
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
