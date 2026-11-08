// Package offers holds the hooks that keep the cars and the lodgings of an
// event, and the places that people take in them, true.
//
// An offer is a car (ride) or a lodging that a member, its owner, proposes for
// an event; a place (offer_members) is a runner who takes one of its seats. The
// owner of an offer and whoever added a place come from the request, so they are
// set by request hooks, as the creator of an event is. What an offer or a place
// has to be (the seats of a car, the dates, who is where) is an invariant of
// the data, so it is checked by model hooks: they also cover the writes that do
// not come from the API (the code of the application, a batch request).
package offers

import (
	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/events"
)

const (
	kindRide    = "ride"
	kindLodging = "lodging"

	// maxRideSeats is the most seats that a car offers, the owner not counted.
	maxRideSeats = 8
)

// Register attaches the hooks of the offers and offer_members collections to app.
func Register(app core.App) {
	app.OnRecordCreateRequest("offers").BindFunc(func(e *core.RecordRequestEvent) error {
		// Whatever the request says, the owner is the runner of the caller. A
		// superuser, or an account without a runner, has none: the offer is
		// then refused by the validation, which requires an owner.
		runner, err := callerRunner(e)
		if err != nil {
			return e.InternalServerError("", err)
		}
		e.Record.Set("owner", runner)
		return e.Next()
	})

	app.OnRecordUpdateRequest("offers").BindFunc(func(e *core.RecordRequestEvent) error {
		// The update rule already refuses a body that names them. This is what
		// keeps them for the callers that the rule does not bind (a superuser).
		for _, field := range []string{"owner", "event", "kind"} {
			e.Record.Set(field, e.Record.Original().GetString(field))
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("offer_members").BindFunc(func(e *core.RecordRequestEvent) error {
		// Whatever the request says, the place was added by the runner of the
		// caller. A superuser has no runner: nobody added it.
		runner, err := callerRunner(e)
		if err != nil {
			return e.InternalServerError("", err)
		}
		e.Record.Set("added_by", runner)
		return e.Next()
	})

	app.OnRecordValidate("offers").BindFunc(func(e *core.RecordEvent) error {
		// What a kind does not have is emptied before the system validation, so
		// that it is not held against the offer: the link of a lodging is
		// checked as an address, and a car has no link.
		switch e.Record.GetString("kind") {
		case kindRide:
			e.Record.Set("end_date", "")
			e.Record.Set("url", "")
		case kindLodging:
			e.Record.Set("time", "")
		}
		// The checks below come after it, so that a missing or unknown value is
		// reported by it, and they can rely on every required one being there.
		if err := e.Next(); err != nil {
			return err
		}
		return validateOffer(e.App, e.Record)
	})

	app.OnRecordValidate("offer_members").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if !e.Record.IsNew() {
			// A place is never changed, except by a superuser, who knows.
			return nil
		}
		return validateSeat(e.App, e.Record)
	})
}

// callerRunner returns the id of the runner whose account is the caller of the
// request, or "" when there is none: a superuser, or an account without a
// runner.
func callerRunner(e *core.RecordRequestEvent) (string, error) {
	if e.Auth == nil || e.HasSuperuserAuth() {
		return "", nil
	}
	runner, err := events.RunnerOf(e.App, e.Auth.Id)
	if err != nil || runner == nil {
		return "", err
	}
	return runner.Id, nil
}

// validateOffer refuses an offer that does not hold together. It is run once the
// system validation has found the event, the kind and the owner.
//
//   - A car has from 1 to 8 seats (apperr.CodeOfferSeatsRequired on seats).
//   - The days are real days (apperr.CodeDateInvalid), and a lodging does not end
//     before it starts (apperr.CodeEndBeforeStart on end_date).
//   - The time is HH:MM (apperr.CodeTimeInvalid).
//   - When an offer is changed, its seats do not go below the people who have
//     one (apperr.CodeOfferSeatsBelowMembers on seats).
//   - When an offer is created, its owner does not have another offer of the
//     same kind for the event, nor a place in one (apperr.CodeOfferAlreadyMember
//     on kind).
func validateOffer(app core.App, offer *core.Record) error {
	seats := offer.GetInt("seats")
	if offer.GetString("kind") == kindRide && (seats < 1 || seats > maxRideSeats) {
		return apperr.Field("seats", apperr.CodeOfferSeatsRequired)
	}

	date, endDate := offer.GetString("date"), offer.GetString("end_date")
	if date != "" {
		if _, ok := events.ParseDay(date); !ok {
			return apperr.Field("date", apperr.CodeDateInvalid)
		}
	}
	if endDate != "" {
		if _, ok := events.ParseDay(endDate); !ok {
			return apperr.Field("end_date", apperr.CodeDateInvalid)
		}
		// Days written YYYY-MM-DD sort like the days they stand for.
		if date != "" && endDate < date {
			return apperr.Field("end_date", apperr.CodeEndBeforeStart)
		}
	}

	if at := offer.GetString("time"); at != "" && !events.ValidTime(at) {
		return apperr.Field("time", apperr.CodeTimeInvalid)
	}

	if !offer.IsNew() {
		taken, err := app.CountRecords("offer_members", dbx.HashExp{"offer": offer.Id})
		if err != nil {
			return err
		}
		// 0 is "not given": a lodging without a limit holds as many as it wants.
		if seats > 0 && int64(seats) < taken {
			return apperr.Field("seats", apperr.CodeOfferSeatsBelowMembers)
		}
		return nil
	}

	already, err := hasPlaceOfKind(app, offer.GetString("owner"), offer.GetString("event"), offer.GetString("kind"), "")
	if err != nil {
		return err
	}
	if already {
		return apperr.Field("kind", apperr.CodeOfferAlreadyMember)
	}
	return nil
}

// validateSeat refuses a new place that does not hold together. It is run once
// the system validation has found the offer and the runner.
//
//   - The owner of an offer does not take a place in it
//     (apperr.CodeOfferOwnerMember on runner).
//   - An offer that has a limit is not full (apperr.CodeOfferFull on offer).
//   - The runner does not have an offer of the same kind for the event, nor a
//     place in another one (apperr.CodeOfferAlreadyMember on runner). A second
//     place in the same offer is for the unique index to refuse.
func validateSeat(app core.App, seat *core.Record) error {
	offer, err := app.FindRecordById("offers", seat.GetString("offer"))
	if err != nil {
		return err
	}
	runner := seat.GetString("runner")
	if runner == offer.GetString("owner") {
		return apperr.Field("runner", apperr.CodeOfferOwnerMember)
	}

	// 0 is "not given": a lodging without a limit takes as many as it is given.
	if seats := int64(offer.GetInt("seats")); seats > 0 {
		taken, err := app.CountRecords("offer_members", dbx.HashExp{"offer": offer.Id})
		if err != nil {
			return err
		}
		if taken >= seats {
			return apperr.Field("offer", apperr.CodeOfferFull)
		}
	}

	already, err := hasPlaceOfKind(app, runner, offer.GetString("event"), offer.GetString("kind"), offer.Id)
	if err != nil {
		return err
	}
	if already {
		return apperr.Field("runner", apperr.CodeOfferAlreadyMember)
	}
	return nil
}

// hasPlaceOfKind reports whether the runner has, for the event, an offer of that
// kind or a place in one, leaving the offer except aside (none when it is
// empty). A runner has at most one of each kind per event, which is what the
// callers check.
func hasPlaceOfKind(app core.App, runner, event, kind, except string) (bool, error) {
	owned, err := app.CountRecords("offers",
		dbx.HashExp{"owner": runner, "event": event, "kind": kind},
		dbx.NewExp("id != {:except}", dbx.Params{"except": except}),
	)
	if err != nil || owned > 0 {
		return owned > 0, err
	}
	placed, err := app.CountRecords("offer_members",
		dbx.HashExp{"runner": runner},
		dbx.NewExp("offer IN (SELECT id FROM offers WHERE event = {:event} AND kind = {:kind} AND id != {:except})",
			dbx.Params{"event": event, "kind": kind, "except": except}),
	)
	return placed > 0, err
}
