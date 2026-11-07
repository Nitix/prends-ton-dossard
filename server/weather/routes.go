package weather

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
	"courses/server/events"
	"courses/server/wording"
)

// path is the route of the weather of a race.
const path = "/api/app/events/{id}/weather"

// The window of the weather: from this many days before the first day to the
// last day, and these many days from today, which is the horizon of Open-Meteo.
const (
	daysBefore = 7
	horizon    = 16
)

// maxPlaceText is the longest text of a place that is sent to the geocoding.
const maxPlaceText = 200

// maxTries is how many texts the geocoding is asked.
const maxTries = 3

// Place says where the weather is for.
type Place struct {
	Source string `json:"source"` // "track" | "place"
	Name   string `json:"name,omitempty"`
	Detail string `json:"detail,omitempty"`
	Format string `json:"format,omitempty"`
}

// Answer is what the route answers. (The JSON of PocketBase omits an empty value only for a field with no value at all, so stale is written as false.)
type Answer struct {
	Status    string `json:"status"` // ok | not_yet | over | no_day | no_place
	From      string `json:"from,omitempty"`
	Query     string `json:"query,omitempty"`
	Place     *Place `json:"place,omitempty"`
	Days      []Day  `json:"days,omitempty"`
	FetchedAt string `json:"fetchedAt,omitempty"`
	Stale     bool   `json:"stale,omitempty"`
}

// trackStart is the first point of a track, if it has one.
type trackStart struct {
	lat, lon float64
	ele      *float64
	ok       bool
}

// forecastValue is a forecast that is kept.
type forecastValue struct{ days []Day }

// service holds the caches and the budget, made once by Register.
type service struct {
	cfg config.Config
	pb  core.App
	src *source

	forecasts *cache[forecastValue]
	places    *cache[found]
	tracks    *cache[trackStart]
	failures  *cache[string]
}

// Register adds GET /api/app/events/{id}/weather (apis.RequireAuth("users")), on
// the demo too, where the budget bounds the calls. The caches and the budget are
// made here, not in the OnServe closure: the closure runs again for each router
// that is built, and what is kept must outlive them.
func Register(app core.App, cfg config.Config) {
	perDay := budgetPerDay
	if cfg.Demo() {
		perDay = demoBudgetPerDay
	}
	s := &service{
		cfg: cfg,
		pb:  app,
		src: &source{
			userAgent: "prends-ton-dossard (+" + cfg.AppURL + ")",
			budget:    &budget{perDay: perDay},
			onSpent: func() {
				app.Logger().Warn("weather: the budget of calls to Open-Meteo is spent for this hour or this day")
			},
		},
		forecasts: newCache[forecastValue](cacheMax),
		places:    newCache[found](cacheMax),
		tracks:    newCache[trackStart](cacheMax),
		failures:  newCache[string](cacheMax),
	}
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET(path, s.route).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
}

var paris = func() *time.Location {
	l, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		// Not possible with the database of time/tzdata that setup links in.
		panic("weather: loading the time zone of the site: " + err.Error())
	}
	return l
}()

func (s *service) route(e *core.RequestEvent) error {
	event, err := e.App.FindRecordById("events", e.Request.PathValue("id"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}
		return e.InternalServerError("", err)
	}
	answer, err := s.answer(e.Request.Context(), event)
	if err != nil {
		e.App.Logger().Warn("weather: unavailable", "event", event.Id, "error", err.Error())
		return apperr.New(http.StatusBadGateway, apperr.CodeWeatherUnavailable)
	}
	return e.JSON(http.StatusOK, answer)
}

// answer is the weather of an event.
func (s *service) answer(ctx context.Context, event *core.Record) (Answer, error) {
	if events.MonthOnly(event) {
		return Answer{Status: "no_day"}, nil
	}
	start := event.GetString("start_date")
	end := event.GetString("end_date")
	if end == "" {
		end = start
	}
	first, err := time.Parse(time.DateOnly, start)
	if err != nil {
		return Answer{}, fmt.Errorf("the start %q: %w", start, err)
	}
	today := now().In(paris).Format(time.DateOnly)
	from := first.AddDate(0, 0, -daysBefore).Format(time.DateOnly)
	switch {
	case today < from:
		return Answer{Status: "not_yet", From: from}, nil
	case today > end:
		return Answer{Status: "over"}, nil
	}
	// The race days that Open-Meteo can tell, from today on. Inside the window
	// (7 days of lead, 16 of horizon) the range is never empty.
	dayFrom := max(start, today)
	todayDate, _ := time.Parse(time.DateOnly, today)
	dayTo := min(end, todayDate.AddDate(0, 0, horizon-1).Format(time.DateOnly))

	lat, lon, ele, place, err := s.whereIs(ctx, event)
	if err != nil {
		return Answer{}, err
	}
	if place == nil {
		return Answer{Status: "no_place", Query: strings.TrimSpace(event.GetString("location"))}, nil
	}
	value, at, stale, err := s.forecast(ctx, lat, lon, ele, dayFrom, dayTo)
	if err != nil {
		return Answer{}, err
	}
	return Answer{
		Status:    "ok",
		Place:     place,
		Days:      value.days,
		FetchedAt: at.UTC().Format(time.RFC3339),
		Stale:     stale,
	}, nil
}

// forecast is the forecast for a place and days: kept an hour, and, when
// Open-Meteo fails, the last one under six hours old.
func (s *service) forecast(ctx context.Context, lat, lon float64, ele *float64, from, to string) (forecastValue, time.Time, bool, error) {
	key := fmt.Sprintf("%.2f|%.2f|%s|%s|%s", lat, lon, elevationKey(ele), from, to)
	unlock, err := s.forecasts.locks.lock(ctx, key)
	if err != nil {
		return forecastValue{}, time.Time{}, false, err
	}
	defer unlock()

	old, have := s.forecasts.get(key)
	if have && old.fresh() {
		return old.value, old.at, false, nil
	}
	var days []Day
	if s.failed("f|" + key) {
		err = errRecentFailure
	} else if days, err = s.src.forecast(ctx, lat, lon, ele, from, to); err != nil {
		s.fail(ctx, "f|"+key, err)
	}
	if err != nil {
		if have && now().Sub(old.at) < forecastStale {
			return old.value, old.at, true, nil
		}
		return forecastValue{}, time.Time{}, false, err
	}
	made := s.forecasts.put(key, forecastValue{days: days}, forecastTTL)
	return made.value, made.at, false, nil
}

func elevationKey(ele *float64) string {
	if ele == nil {
		return "-"
	}
	return fmt.Sprintf("%d", elevation50(*ele))
}

// whereIs finds the place of the weather: the start of the first track, else the
// place of the race. place is nil when nothing is found.
func (s *service) whereIs(ctx context.Context, event *core.Record) (lat, lon float64, ele *float64, place *Place, err error) {
	formats, err := s.formatsOf(event)
	if err != nil {
		return 0, 0, nil, nil, err
	}
	for _, f := range formats {
		name := f.GetString("gpx")
		if name == "" {
			continue
		}
		point, err := s.trackStart(ctx, f, name)
		if err != nil {
			return 0, 0, nil, nil, err
		}
		if !point.ok {
			break // a track with no point: the place of the race
		}
		title, err := s.titleOf(f)
		if err != nil {
			return 0, 0, nil, nil, err
		}
		return point.lat, point.lon, point.ele, &Place{Source: "track", Format: title}, nil
	}

	text := clipText(event.GetString("location"))
	for _, try := range tries(text) {
		got, err := s.geocode(ctx, try)
		if err != nil {
			return 0, 0, nil, nil, err
		}
		if got.OK {
			return got.Lat, got.Lon, nil, &Place{Source: "place", Name: got.Name, Detail: got.Detail}, nil
		}
	}
	return 0, 0, nil, nil, nil
}

// clipText keeps maxPlaceText characters of the text of a place.
func clipText(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > maxPlaceText {
		r = r[:maxPlaceText]
	}
	return string(r)
}

// tries are the texts to ask the geocoding, in order: the whole text, then each
// of its parts between commas, from the last to the first; three at most, none
// twice.
func tries(text string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(t string) {
		t = strings.TrimSpace(t)
		k := wording.Fold(t)
		if t == "" || seen[k] || len(out) == maxTries {
			return
		}
		seen[k] = true
		out = append(out, t)
	}
	add(text)
	parts := strings.Split(text, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		add(parts[i])
	}
	return out
}

// geocode is the first place of text, kept 30 days, or a day when there is none.
func (s *service) geocode(ctx context.Context, text string) (found, error) {
	key := wording.Fold(text)
	unlock, err := s.places.locks.lock(ctx, key)
	if err != nil {
		return found{}, err
	}
	defer unlock()
	if e, ok := s.places.get(key); ok && e.fresh() {
		return e.value, nil
	}
	if s.failed("g|" + key) {
		return found{}, errRecentFailure
	}
	got, err := s.src.geocode(ctx, text)
	if err != nil {
		s.fail(ctx, "g|"+key, err)
		return found{}, err
	}
	ttl := placeTTL
	if !got.OK {
		ttl = notFoundTTL
	}
	s.places.put(key, got, ttl)
	return got, nil
}

// formatsOf are the formats of an event in the order of its page: by day, then
// by distance (a race with no distance last), then by id.
func (s *service) formatsOf(event *core.Record) ([]*core.Record, error) {
	formats, err := s.pb.FindRecordsByFilter("formats", "event = {:event}", "", 0, 0, dbx.Params{"event": event.Id})
	if err != nil {
		return nil, err
	}
	day := func(f *core.Record) string {
		if d := f.GetString("date"); d != "" {
			return d
		}
		return event.GetString("start_date")
	}
	distance := func(f *core.Record) float64 {
		if d := f.GetFloat("distance_km"); d > 0 {
			return d
		}
		return 1e18
	}
	sort.SliceStable(formats, func(i, j int) bool {
		a, b := formats[i], formats[j]
		if day(a) != day(b) {
			return day(a) < day(b)
		}
		if distance(a) != distance(b) {
			return distance(a) < distance(b)
		}
		return a.Id < b.Id
	})
	return formats, nil
}

// titleOf is what a race is called, as the site does.
func (s *service) titleOf(f *core.Record) (string, error) {
	raceType, err := s.pb.FindRecordById("race_types", f.GetString("race_type"))
	if err != nil {
		return "", err
	}
	return wording.Of("fr").RaceName(f.GetString("name"), raceType.GetString("label"),
		f.GetFloat("distance_km"), f.GetInt("duration_min"), f.GetInt("time_limit_min")), nil
}

// trackStart is the first point of the track of a format, kept by the name of
// its file (which changes with each upload), with no limit of time.
func (s *service) trackStart(ctx context.Context, f *core.Record, name string) (trackStart, error) {
	unlock, err := s.tracks.locks.lock(ctx, name)
	if err != nil {
		return trackStart{}, err
	}
	defer unlock()
	if e, ok := s.tracks.get(name); ok {
		return e.value, nil
	}
	fsys, err := s.pb.NewFilesystem()
	if err != nil {
		return trackStart{}, err // the storage as a whole
	}
	defer fsys.Close()
	// A file that is missing or cannot be read is not the weather's failure: it
	// is said in the log, and the place of the race answers, as for a track with
	// no point. Nothing is kept, so a file that comes back is read again.
	reader, err := fsys.GetReader(f.BaseFilesPath() + "/" + name)
	if err != nil {
		s.pb.Logger().Warn("weather: a track could not be opened", "format", f.Id, "error", err.Error())
		return trackStart{}, nil
	}
	defer reader.Close()
	lat, lon, ele, ok, err := firstPoint(reader)
	if err != nil {
		s.pb.Logger().Warn("weather: a track could not be read", "format", f.Id, "error", err.Error())
		return trackStart{}, nil
	}
	point := trackStart{lat: lat, lon: lon, ele: ele, ok: ok}
	s.tracks.put(name, point, 0)
	return point, nil
}

// failureTTL is how long a failed call is remembered for its key: the requests
// that waited for it get its answer, and do not each call Open-Meteo again.
const failureTTL = time.Minute

var errRecentFailure = errors.New("weather: the last call for this key failed a moment ago")

// failed says whether a call for key failed less than failureTTL ago.
func (s *service) failed(key string) bool {
	e, ok := s.failures.get(key)
	return ok && e.fresh()
}

// fail remembers a failed call. Two failures are not the call's: a spent budget
// (nothing was asked) and the request's own context ending (its member went
// away, which says nothing of Open-Meteo). A timeout of the client, a refused
// connection and a 5xx are remembered, though a client timeout also is a
// context.DeadlineExceeded: only the context of the request is looked at.
func (s *service) fail(ctx context.Context, key string, err error) {
	if errors.Is(err, errBudget) || ctx.Err() != nil {
		return
	}
	s.failures.put(key, err.Error(), failureTTL)
}
