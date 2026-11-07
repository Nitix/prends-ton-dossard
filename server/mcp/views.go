package mcp

import (
	"cmp"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
	"time"

	"courses/server/config"
	"courses/server/events"
	"courses/server/wording"
)

// The statuses of a participation that the tools tell apart (spec § 6.1).
const (
	statusDNS       = "dns"
	statusSupporter = "supporter"
)

// ---------------------------------------------------------------------------
// The records of the API, as the reads decode them. Only what the tools say is
// there; a field that is not set comes as "" or 0, as the site reads it (spec
// § 6.1: an empty value is "not given").

// runnerRecord is a runner. User is the id of the account, which is only read to
// say whether the runner has one and whether it is the caller's: no answer holds
// it.
type runnerRecord struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	User   string `json:"user"`
	Avatar string `json:"avatar"`
	// Updated is read by set_photo, for the state of its confirmation.
	Updated string `json:"updated"`
}

// raceTypeRecord is a type of race, with the measures that the form of a format
// shows first for it (none: all four).
type raceTypeRecord struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Measures []string `json:"measures"`
}

// eventRecord is an event, with what eventExpand asks for.
type eventRecord struct {
	ID                      string `json:"id"`
	Name                    string `json:"name"`
	Location                string `json:"location"`
	StartDate               string `json:"start_date"`
	EndDate                 string `json:"end_date"`
	RegistrationURL         string `json:"registration_url"`
	RegistrationDeadline    string `json:"registration_deadline"`
	RegistrationOpening     string `json:"registration_opening"`
	RegistrationOpeningTime string `json:"registration_opening_time"`
	DatePrecision           string `json:"date_precision"`
	Notes                   string `json:"notes"`
	CreatedBy               string `json:"created_by"`
	Updated                 string `json:"updated"`
	Expand                  struct {
		Formats        []formatRecord        `json:"formats_via_event"`
		Participations []participationRecord `json:"participations_via_event"`
		// CreatedBy is asked by the tools that write a race (eventForWrite).
		CreatedBy runnerRecord `json:"created_by"`
	} `json:"expand"`
}

// formatRecord is a race of an event, with its race type expanded.
type formatRecord struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	RaceType       string  `json:"race_type"`
	DistanceKm     float64 `json:"distance_km"`
	DurationMin    int     `json:"duration_min"`
	TimeLimitMin   int     `json:"time_limit_min"`
	ElevationGainM int     `json:"elevation_gain_m"`
	PriceEur       float64 `json:"price_eur"`
	GPX            string  `json:"gpx"`
	RouteURL       string  `json:"route_url"`
	Date           string  `json:"date"`
	Event          string  `json:"event"`
	Updated        string  `json:"updated"`
	Expand         struct {
		RaceType raceTypeRecord `json:"race_type"`
	} `json:"expand"`
}

// participationRecord is a participation, with its runner and who added it
// expanded (and, for the reads that ask for them, its event and its format, the
// format with its race type). Format is empty for a participation on the event
// alone.
type participationRecord struct {
	ID          string `json:"id"`
	Runner      string `json:"runner"`
	Format      string `json:"format"`
	Status      string `json:"status"`
	AddedBy     string `json:"added_by"`
	Confirmed   bool   `json:"confirmed"`
	FinishTimeS int    `json:"finish_time_s"`
	Rank        int    `json:"rank"`
	RankOf      int    `json:"rank_of"`
	ResultNote  string `json:"result_note"`
	Updated     string `json:"updated"`
	Expand      struct {
		Runner  runnerRecord `json:"runner"`
		AddedBy runnerRecord `json:"added_by"`
		Event   eventRecord  `json:"event"`
		Format  formatRecord `json:"format"`
	} `json:"expand"`
}

// commentRecord is a comment on an event, with its author and its event expanded
// for the reads that ask for them.
type commentRecord struct {
	ID      string `json:"id"`
	Author  string `json:"author"`
	Event   string `json:"event"`
	Body    string `json:"body"`
	Created string `json:"created"`
	Updated string `json:"updated"`
	Expand  struct {
		Author runnerRecord `json:"author"`
		Event  eventRecord  `json:"event"`
	} `json:"expand"`
}

// offerRecord is a ride or a lodging, with its owner expanded (and, for the tools
// that write one, its event).
type offerRecord struct {
	ID      string `json:"id"`
	Event   string `json:"event"`
	Kind    string `json:"kind"`
	Place   string `json:"place"`
	Seats   int    `json:"seats"`
	Date    string `json:"date"`
	Time    string `json:"time"`
	EndDate string `json:"end_date"`
	URL     string `json:"url"`
	Notes   string `json:"notes"`
	Updated string `json:"updated"`
	Expand  struct {
		Owner runnerRecord `json:"owner"`
		Event eventRecord  `json:"event"`
	} `json:"expand"`
}

// offerMemberRecord is a place taken in an offer, with its runner and who added
// it expanded.
type offerMemberRecord struct {
	ID      string `json:"id"`
	Offer   string `json:"offer"`
	Runner  string `json:"runner"`
	AddedBy string `json:"added_by"`
	Updated string `json:"updated"`
	Expand  struct {
		Runner  runnerRecord `json:"runner"`
		AddedBy runnerRecord `json:"added_by"`
	} `json:"expand"`
}

// ---------------------------------------------------------------------------
// The shapes of spec § 6.4 that several tools share. They are defined here, once:
// the tools that answer one use these.

// runnerRef is a runner in an answer: never more than who it is.
type runnerRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// eventRef is a race in an answer that is about something else: where to find it.
type eventRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url" jsonschema:"l'adresse de la course sur le site"`
}

// runnerOut is a runner of the group (spec § 6.4, list_runners). It never says
// the account: only whether there is one (the runner can confirm what is added
// in their name) and whether it is the caller's.
type runnerOut struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	HasAccount bool   `json:"has_account" jsonschema:"vrai si la personne a un compte, donc peut confirmer elle-même ce qu'on ajoute à son nom"`
	IsMe       bool   `json:"is_me" jsonschema:"vrai pour le coureur de la personne au nom de qui tu agis"`
	URL        string `json:"url" jsonschema:"l'adresse de sa page sur le site"`
}

// resultOut is the result of a participation (spec § 6.4).
type resultOut struct {
	FinishTime  string `json:"finish_time,omitempty" jsonschema:"le temps, h:mm:ss"`
	FinishTimeS int    `json:"finish_time_s,omitempty" jsonschema:"le temps, en secondes"`
	Rank        int    `json:"rank,omitempty" jsonschema:"le classement général"`
	RankOf      int    `json:"rank_of,omitempty" jsonschema:"le nombre de classés"`
	Note        string `json:"note,omitempty"`
}

// participationOut is a participation (spec § 6.4, PARTICIPATION).
type participationOut struct {
	ID          string    `json:"id"`
	Runner      runnerRef `json:"runner"`
	Status      string    `json:"status" jsonschema:"interested, registered, finished, dnf, dns ou supporter"`
	StatusLabel string    `json:"status_label" jsonschema:"le libellé du statut, comme le site (Intéressé, Inscrit, Terminé, Abandon, Non partant, Supporteur)"`
	Confirmed   bool      `json:"confirmed" jsonschema:"vrai quand le coureur l'a ajoutée ou modifiée lui-même ; sinon elle attend sa confirmation sur le site"`
	AddedBy     runnerRef `json:"added_by,omitzero" jsonschema:"qui l'a ajoutée"`
	Result      resultOut `json:"result,omitzero" jsonschema:"le résultat, quand il y en a un"`
}

// offerMemberOut is a place taken in an offer (spec § 6.4, OFFER).
type offerMemberOut struct {
	PlaceID string    `json:"place_id" jsonschema:"l'identifiant de la place, pour la libérer"`
	Runner  runnerRef `json:"runner"`
	AddedBy runnerRef `json:"added_by,omitzero"`
}

// offerOut is a ride or a lodging with the people who have a place in it (spec
// § 6.4, OFFER).
type offerOut struct {
	ID      string           `json:"id"`
	Kind    string           `json:"kind" jsonschema:"ride (une voiture) ou lodging (un logement)"`
	Owner   runnerRef        `json:"owner" jsonschema:"qui propose les places"`
	Place   string           `json:"place" jsonschema:"le lieu de départ d'une voiture, le nom ou l'adresse d'un logement"`
	Seats   int              `json:"seats,omitempty" jsonschema:"les places offertes, sans compter le propriétaire ; absent pour un logement sans limite"`
	Taken   int              `json:"taken" jsonschema:"les places prises"`
	Date    string           `json:"date,omitempty" jsonschema:"le jour du départ, ou de l'arrivée"`
	Time    string           `json:"time,omitempty" jsonschema:"l'heure de départ d'une voiture, HH:MM"`
	EndDate string           `json:"end_date,omitempty" jsonschema:"le jour de départ d'un logement"`
	URL     string           `json:"url,omitempty" jsonschema:"l'annonce d'un logement"`
	Notes   string           `json:"notes,omitempty"`
	Members []offerMemberOut `json:"members" jsonschema:"ceux qui ont une place"`
}

// commentOut is a comment on an event (spec § 6.4).
type commentOut struct {
	ID      string    `json:"id"`
	Author  runnerRef `json:"author"`
	Body    string    `json:"body"`
	Created string    `json:"created" jsonschema:"quand il a été écrit, comme PocketBase le date : en UTC (le site l'affiche à l'heure de Paris)"`
	Edited  bool      `json:"edited" jsonschema:"vrai s'il a été modifié après avoir été écrit"`
}

// eventSummary is a race as a list shows it (spec § 6.4, EVENT_SUMMARY).
type eventSummary struct {
	ID                      string          `json:"id"`
	Name                    string          `json:"name"`
	Location                string          `json:"location"`
	StartDate               string          `json:"start_date"`
	EndDate                 string          `json:"end_date,omitempty" jsonschema:"le dernier jour d'une course de plusieurs jours ; absent pour une course d'un seul jour (start_date en est alors le seul jour)"`
	RegistrationDeadline    string          `json:"registration_deadline,omitempty" jsonschema:"le dernier jour pour s'inscrire, ce jour compris ; absente : la course n'a pas de date limite renseignée"`
	RegistrationOpening     string          `json:"registration_opening,omitempty" jsonschema:"le jour où les inscriptions ouvrent ; absente : l'ouverture n'est pas renseignée"`
	RegistrationOpeningTime string          `json:"registration_opening_time,omitempty" jsonschema:"l'heure d'ouverture, à l'heure de Paris ; absente : le site compte 9 h"`
	DatePrecision           string          `json:"date_precision,omitempty" jsonschema:"month : seul le mois est connu, le jour ne l'est pas : start_date est le 1er du mois, end_date son dernier jour, et les épreuves n'ont pas de date ; absent : la course a son jour"`
	URL                     string          `json:"url" jsonschema:"l'adresse de la course sur le site"`
	Formats                 []formatSummary `json:"formats"`
	Participants            int             `json:"participants" jsonschema:"les participations de la course qui ne sont pas « Non partant » (dns), supporteurs et intéressés sans épreuve compris : ce n'est pas le nombre de coureurs au départ"`
	Mine                    []mineOut       `json:"mine" jsonschema:"les participations de la personne au nom de qui tu agis"`
}

type formatSummary struct {
	ID       string `json:"id"`
	Title    string `json:"title" jsonschema:"comme le site l'écrit : son nom, sinon le type et la mesure (Trail 42 km)"`
	RaceType string `json:"race_type" jsonschema:"le nom du type de course"`
	Date     string `json:"date" jsonschema:"le jour de l'épreuve (le premier jour de la course quand elle n'a pas de date)"`
}

type mineOut struct {
	ParticipationID string `json:"participation_id"`
	FormatID        string `json:"format_id,omitempty" jsonschema:"absent pour une participation à la course seule (intéressé sans épreuve, supporteur)"`
	Status          string `json:"status"`
	StatusLabel     string `json:"status_label"`
}

// eventDetail is the page of a race (spec § 6.4, get_event).
type eventDetail struct {
	ID                      string             `json:"id"`
	Name                    string             `json:"name"`
	Location                string             `json:"location"`
	StartDate               string             `json:"start_date"`
	EndDate                 string             `json:"end_date,omitempty" jsonschema:"le dernier jour d'une course de plusieurs jours ; absent pour une course d'un seul jour (start_date en est alors le seul jour)"`
	RegistrationURL         string             `json:"registration_url,omitempty" jsonschema:"où s'inscrire sur le site officiel de la course"`
	RegistrationDeadline    string             `json:"registration_deadline,omitempty" jsonschema:"le dernier jour pour s'inscrire, ce jour compris ; absente : la course n'a pas de date limite renseignée"`
	RegistrationOpening     string             `json:"registration_opening,omitempty" jsonschema:"le jour où les inscriptions ouvrent ; absente : l'ouverture n'est pas renseignée"`
	RegistrationOpeningTime string             `json:"registration_opening_time,omitempty" jsonschema:"l'heure d'ouverture, à l'heure de Paris ; absente : le site compte 9 h"`
	DatePrecision           string             `json:"date_precision,omitempty" jsonschema:"month : seul le mois est connu, le jour ne l'est pas : start_date est le 1er du mois, end_date son dernier jour, et les épreuves n'ont pas de date (leur day est le 1er) ; absent : la course a son jour"`
	Notes                   string             `json:"notes,omitempty"`
	CreatedBy               runnerRef          `json:"created_by,omitzero"`
	URL                     string             `json:"url" jsonschema:"l'adresse de la course sur le site"`
	Formats                 []formatDetail     `json:"formats" jsonschema:"les épreuves, par jour puis par distance"`
	Undecided               []participationOut `json:"undecided" jsonschema:"les intéressés qui n'ont pas encore choisi d'épreuve"`
	Supporters              []participationOut `json:"supporters" jsonschema:"ceux qui viennent encourager"`
	Rides                   []offerOut         `json:"rides" jsonschema:"les voitures proposées"`
	Lodgings                []offerOut         `json:"lodgings" jsonschema:"les logements proposés"`
	Comments                []commentOut       `json:"comments" jsonschema:"les 50 derniers, du plus ancien au plus récent"`
	CommentsTotal           int                `json:"comments_total" jsonschema:"le nombre de commentaires de la course : comments n'en donne que les 50 derniers"`
}

type formatDetail struct {
	ID             string             `json:"id"`
	Title          string             `json:"title" jsonschema:"comme le site l'écrit : son nom, sinon le type et la mesure (Trail 42 km)"`
	Name           string             `json:"name,omitempty" jsonschema:"le nom que la personne qui l'a créée lui a donné"`
	RaceType       raceTypeRef        `json:"race_type"`
	DistanceKm     float64            `json:"distance_km,omitempty"`
	DurationMin    int                `json:"duration_min,omitempty" jsonschema:"la durée d'une course au temps, en minutes"`
	ElevationGainM int                `json:"elevation_gain_m,omitempty" jsonschema:"le dénivelé positif, en mètres"`
	TimeLimitMin   int                `json:"time_limit_min,omitempty" jsonschema:"le temps maximum, en minutes"`
	PriceEur       float64            `json:"price_eur,omitempty"`
	Date           string             `json:"date,omitempty" jsonschema:"le jour de l'épreuve quand il n'est pas celui du début de la course"`
	Day            string             `json:"day" jsonschema:"le jour de l'épreuve : sa date, sinon le premier jour de la course"`
	RouteURL       string             `json:"route_url,omitempty" jsonschema:"un lien vers le parcours"`
	TrackURL       string             `json:"track_url,omitempty" jsonschema:"l'adresse du fichier de la trace GPX, s'il y en a un"`
	Participants   []participationOut `json:"participants" jsonschema:"les participations à cette épreuve, « Non partant » (status dns) compris"`
}

type raceTypeRef struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// eventURL is the address of a race on the site.
func eventURL(cfg config.Config, id string) string {
	return cfg.AppURL + "/evenements/" + id
}

// runnerURL is the address of the page of a runner on the site.
func runnerURL(cfg config.Config, id string) string {
	return cfg.AppURL + "/coureurs/" + id
}

// photoURL is the address of the photo of a runner: the file is not protected, as
// on the site. "" for a runner who has none.
func photoURL(cfg config.Config, r runnerRecord) string {
	if r.Avatar == "" {
		return ""
	}
	return cfg.AppURL + "/api/files/runners/" + r.ID + "/" + url.PathEscape(r.Avatar)
}

// trackURL is the address of the GPX track of a format: the file is not
// protected, as on the site. "" for a format that has none.
func trackURL(cfg config.Config, f formatRecord) string {
	if f.GPX == "" {
		return ""
	}
	return cfg.AppURL + "/api/files/formats/" + f.ID + "/" + url.PathEscape(f.GPX)
}

// ref is a runner in an answer. A runner that the API did not send (a
// participation that nobody added, a creator who is gone) is the zero value,
// which an answer leaves out.
func (r runnerRecord) ref() runnerRef {
	return runnerRef{ID: r.ID, Name: r.Name}
}

// newRunnerOut is a runner of the group, for the caller whose account is userID.
func newRunnerOut(cfg config.Config, r runnerRecord, userID string) runnerOut {
	return runnerOut{
		ID: r.ID, Name: r.Name,
		HasAccount: r.User != "",
		IsMe:       r.User != "" && r.User == userID,
		URL:        runnerURL(cfg, r.ID),
	}
}

// out is a participation in an answer. It needs its runner, and who added it,
// expanded.
func (p participationRecord) out(w wording.Words) participationOut {
	out := participationOut{
		ID:          p.ID,
		Runner:      p.Expand.Runner.ref(),
		Status:      p.Status,
		StatusLabel: w.Status(p.Status),
		Confirmed:   p.Confirmed,
		AddedBy:     p.Expand.AddedBy.ref(),
	}
	// A result is a time, a rank or a note: the number of people ranked alone is
	// not one (hasResult of features/results/resultText.ts).
	if note := strings.TrimSpace(p.ResultNote); p.FinishTimeS != 0 || p.Rank != 0 || note != "" {
		out.Result = resultOut{FinishTimeS: p.FinishTimeS, Rank: p.Rank, RankOf: p.RankOf, Note: note}
		if p.FinishTimeS != 0 {
			out.Result.FinishTime = raceTime(p.FinishTimeS)
		}
	}
	return out
}

// raceTime writes a time in seconds as the tools give a time in a field
// (spec § 6.1): h:mm:ss, "4:12:30". The site's own raceTime, "4h 12min 30s", is
// wording.RaceTime: it is what a result is written with in a line of text.
func raceTime(seconds int) string {
	return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds%3600/60, seconds%60)
}

// newOfferOut is an offer with the places taken in it, by runner name. The offer
// needs its owner expanded, and each place its runner and who added it.
func newOfferOut(o offerRecord, places []offerMemberRecord) offerOut {
	members := slices.SortedFunc(slices.Values(places), func(a, b offerMemberRecord) int {
		return cmp.Or(compareNames(a.Expand.Runner.Name, b.Expand.Runner.Name), cmp.Compare(a.ID, b.ID))
	})
	out := offerOut{
		ID: o.ID, Kind: o.Kind, Owner: o.Expand.Owner.ref(), Place: o.Place,
		Seats: o.Seats, Taken: len(members),
		Date: o.Date, Time: o.Time, EndDate: o.EndDate, URL: o.URL, Notes: o.Notes,
		Members: []offerMemberOut{},
	}
	for _, m := range members {
		out.Members = append(out.Members, offerMemberOut{PlaceID: m.ID, Runner: m.Expand.Runner.ref(), AddedBy: m.Expand.AddedBy.ref()})
	}
	return out
}

// newCommentOut is a comment in an answer.
func newCommentOut(c commentRecord, author runnerRef) commentOut {
	return commentOut{ID: c.ID, Author: author, Body: c.Body, Created: c.Created, Edited: isEdited(c.Created, c.Updated)}
}

// editGrace is how long after it was written a comment is still not called edited:
// PocketBase dates a new record's creation and update with two reads of the
// clock, a millisecond apart.
const editGrace = time.Second

// pocketbaseTime is how PocketBase writes a date and a time.
const pocketbaseTime = "2006-01-02 15:04:05.000Z"

// isEdited ports isEdited of web/src/features/comments/api.ts: the author changed
// the comment more than a second after writing it. A date that is not one makes
// no difference to say.
func isEdited(created, updated string) bool {
	from, err := time.Parse(pocketbaseTime, created)
	if err != nil {
		return false
	}
	to, err := time.Parse(pocketbaseTime, updated)
	if err != nil {
		return false
	}
	return to.Sub(from) > editGrace
}

// ---------------------------------------------------------------------------
// An event, laid out as the screens of the site read it (toEventView of
// web/src/features/events/api.ts).

// formatView is a race of an event with the day it takes place and its
// participations, by runner name.
type formatView struct {
	record         formatRecord
	raceType       raceTypeRecord
	day            string
	participations []participationRecord
}

// eventView is an event with its races, and who is on them: on a race, or, with no
// race, on the event alone (interested with a race to choose, or supporter). The
// page of a race has more: who made it, its comments, its rides and lodgings (see
// tools.eventView); a list has none of that.
type eventView struct {
	record     eventRecord
	formats    []formatView
	undecided  []participationRecord
	supporters []participationRecord

	createdBy       runnerRef
	comments        []commentOut
	commentsTotal   int
	rides, lodgings []offerOut
}

// newEventView lays out an event of the answer to a request made with
// eventExpand. The shape is the API's contract, as for the site: a race without
// its type, a participation without its runner, or on a race that is not one of
// the event's, is an error.
func newEventView(record eventRecord) (eventView, error) {
	view := eventView{record: record}

	position := map[string]int{}
	for _, f := range record.Expand.Formats {
		if f.Expand.RaceType.ID == "" {
			return eventView{}, fmt.Errorf("mcp: the format %s has no race type in the answer", f.ID)
		}
		position[f.ID] = len(view.formats)
		view.formats = append(view.formats, formatView{
			record: f, raceType: f.Expand.RaceType, day: cmp.Or(f.Date, record.StartDate),
		})
	}
	for _, p := range record.Expand.Participations {
		if p.Expand.Runner.ID == "" {
			return eventView{}, fmt.Errorf("mcp: the participation %s has no runner in the answer", p.ID)
		}
		switch i, onFormat := position[p.Format]; {
		case p.Format == "" && p.Status == statusSupporter:
			view.supporters = append(view.supporters, p)
		case p.Format == "":
			view.undecided = append(view.undecided, p)
		case !onFormat:
			return eventView{}, errors.New("mcp: the participation " + p.ID + " is on a format that is not one of the event's")
		default:
			view.formats[i].participations = append(view.formats[i].participations, p)
		}
	}

	slices.SortFunc(view.formats, compareFormats)
	for i := range view.formats {
		slices.SortFunc(view.formats[i].participations, byRunnerName)
	}
	slices.SortFunc(view.undecided, byRunnerName)
	slices.SortFunc(view.supporters, byRunnerName)
	return view, nil
}

// byRunnerName orders participations by the name of their runner.
func byRunnerName(a, b participationRecord) int {
	return cmp.Or(compareNames(a.Expand.Runner.Name, b.Expand.Runner.Name), cmp.Compare(a.ID, b.ID))
}

// compareFormats ports compareFormats of the site: earlier days first, then
// shorter distances, a timed race having no distance and coming last.
func compareFormats(a, b formatView) int {
	distance := func(f formatView) float64 {
		if f.record.DistanceKm == 0 {
			return math.Inf(1)
		}
		return f.record.DistanceKm
	}
	return cmp.Or(cmp.Compare(a.day, b.day), cmp.Compare(distance(a), distance(b)), cmp.Compare(a.record.ID, b.record.ID))
}

// precisionMonth is date_precision of an event known by its month only: the start
// is the 1st of the month, the end its last day, and the races have no day.
const precisionMonth = "month"

// monthOnly reports whether the event is known by its month only (isMonthOnly of
// lib/dates.ts).
func (r eventRecord) monthOnly() bool { return r.DatePrecision == precisionMonth }

// datePrecisionOf is the precision of the date to say in an answer: "month" for an
// event known by its month, "" (left out) for a day.
func datePrecisionOf(r eventRecord) string {
	if r.monthOnly() {
		return precisionMonth
	}
	return ""
}

// lastDayOfMonth is the last day of the month of a day (YYYY-MM-DD): the day
// itself when it is not a real day, so that nothing is made up of it.
func lastDayOfMonth(day string) string {
	if last, ok := events.LastDayOfMonth(day); ok {
		return last
	}
	return day
}

// lastRaceDay ports lastRaceDay of lib/dates.ts: the day that says whether a race
// is behind and orders it, the last day of the month for an event known by its
// month only, otherwise the day of the race (its own, or the start of the event).
func lastRaceDay(event eventRecord, formatDate string) string {
	if event.monthOnly() {
		return lastDayOfMonth(event.StartDate)
	}
	return cmp.Or(formatDate, event.StartDate)
}

// sortEvents ports sortEvents of the site: the events that start first come first
// (ascending false: last), and on the same day they go by name, then by id. An event
// known by its month only goes at the end of its month, after the events that start
// on that day.
func sortEvents(views []eventView, ascending bool) {
	sign := 1
	if !ascending {
		sign = -1
	}
	orderDay := func(v eventView) string {
		if v.record.monthOnly() {
			return lastRaceDay(v.record, "")
		}
		return v.record.StartDate
	}
	monthRank := func(v eventView) int {
		if v.record.monthOnly() {
			return 1
		}
		return 0
	}
	slices.SortStableFunc(views, func(a, b eventView) int {
		return cmp.Or(
			sign*cmp.Or(cmp.Compare(orderDay(a), orderDay(b)), cmp.Compare(monthRank(a), monthRank(b))),
			compareNames(a.record.Name, b.record.Name),
			cmp.Compare(a.record.ID, b.record.ID),
		)
	})
}

// title is what a race is called, as the site does.
func (f formatView) title(w wording.Words) string {
	return w.RaceName(f.record.Name, f.raceType.Label, f.record.DistanceKm, f.record.DurationMin, f.record.TimeLimitMin)
}

// participations are all the participations of the event: on a race, or on the
// event alone.
func (v eventView) participations() []participationRecord {
	var all []participationRecord
	for _, f := range v.formats {
		all = append(all, f.participations...)
	}
	all = append(all, v.undecided...)
	return append(all, v.supporters...)
}

// isOnEvent ports isOnEvent of the site: whether the runner has a participation
// in the event that is not "not starting", on a race or on the event alone.
func (v eventView) isOnEvent(runnerID string) bool {
	return slices.ContainsFunc(v.participations(), func(p participationRecord) bool {
		return p.Runner == runnerID && p.Status != statusDNS
	})
}

// hasRaceType reports whether the event has a race of that type.
func (v eventView) hasRaceType(raceTypeID string) bool {
	return slices.ContainsFunc(v.formats, func(f formatView) bool { return f.raceType.ID == raceTypeID })
}

// summary is the event as a list shows it. me is the runner of the caller, whose
// participations are in mine ("" for none).
func (v eventView) summary(cfg config.Config, w wording.Words, me string) eventSummary {
	out := eventSummary{
		ID: v.record.ID, Name: v.record.Name, Location: v.record.Location,
		StartDate: v.record.StartDate, EndDate: v.record.EndDate,
		RegistrationDeadline: v.record.RegistrationDeadline,
		RegistrationOpening:  v.record.RegistrationOpening, RegistrationOpeningTime: v.record.RegistrationOpeningTime,
		DatePrecision: datePrecisionOf(v.record),
		URL:           eventURL(cfg, v.record.ID),
		Formats:       []formatSummary{},
		Mine:          []mineOut{},
	}
	for _, f := range v.formats {
		out.Formats = append(out.Formats, formatSummary{ID: f.record.ID, Title: f.title(w), RaceType: f.raceType.Label, Date: f.day})
	}
	for _, p := range v.participations() {
		if p.Status != statusDNS {
			out.Participants++
		}
		if me != "" && p.Runner == me {
			out.Mine = append(out.Mine, mineOut{ParticipationID: p.ID, FormatID: p.Format, Status: p.Status, StatusLabel: w.Status(p.Status)})
		}
	}
	return out
}

// detail is the page of the event.
func (v eventView) detail(cfg config.Config, w wording.Words) eventDetail {
	out := eventDetail{
		ID: v.record.ID, Name: v.record.Name, Location: v.record.Location,
		StartDate: v.record.StartDate, EndDate: v.record.EndDate,
		RegistrationURL: v.record.RegistrationURL, RegistrationDeadline: v.record.RegistrationDeadline,
		RegistrationOpening: v.record.RegistrationOpening, RegistrationOpeningTime: v.record.RegistrationOpeningTime,
		DatePrecision: datePrecisionOf(v.record),
		Notes:         v.record.Notes,
		CreatedBy:     v.createdBy,
		URL:           eventURL(cfg, v.record.ID),
		Formats:       []formatDetail{},
		Undecided:     participationsOut(v.undecided, w),
		Supporters:    participationsOut(v.supporters, w),
		Rides:         orEmpty(v.rides),
		Lodgings:      orEmpty(v.lodgings),
		Comments:      orEmpty(v.comments),
		CommentsTotal: v.commentsTotal,
	}
	for _, f := range v.formats {
		detail := formatDetail{
			ID: f.record.ID, Title: f.title(w), Name: f.record.Name,
			RaceType:   raceTypeRef{ID: f.raceType.ID, Label: f.raceType.Label},
			DistanceKm: f.record.DistanceKm, DurationMin: f.record.DurationMin,
			ElevationGainM: f.record.ElevationGainM, TimeLimitMin: f.record.TimeLimitMin,
			PriceEur: f.record.PriceEur,
			Date:     f.record.Date, Day: f.day,
			RouteURL:     f.record.RouteURL,
			Participants: participationsOut(f.participations, w),
		}
		detail.TrackURL = trackURL(cfg, f.record)
		out.Formats = append(out.Formats, detail)
	}
	return out
}

// participationsOut are participations in an answer, in their order.
func participationsOut(list []participationRecord, w wording.Words) []participationOut {
	out := make([]participationOut, 0, len(list))
	for _, p := range list {
		out = append(out, p.out(w))
	}
	return out
}

// orEmpty is a list that is never nil: an answer has [], not null.
func orEmpty[T any](list []T) []T {
	if list == nil {
		return []T{}
	}
	return list
}
