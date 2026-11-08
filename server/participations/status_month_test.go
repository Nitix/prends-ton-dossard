package participations_test

import (
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	hooks "courses/server/participations"
	"courses/server/testutil"
)

// A race that is known by its month only starts on the 1st: "finished" and
// "dnf" are allowed from that day (the day of the race is not known, and
// status_before_race does not change). Before it, they are refused.
func TestParticipations_StatusBeforeRace_MonthOnly(t *testing.T) {
	for _, tt := range []struct {
		name   string
		now    string
		status int
	}{
		{"on the 1st of the month", "2027-06-01", http.StatusOK},
		{"in the middle of the month", "2027-06-15", http.StatusOK},
		{"the day before the month", "2027-05-31", http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			noon, err := time.ParseInLocation("2006-01-02 15:04", tt.now+" 12:00", paris)
			if err != nil {
				t.Fatal(err)
			}
			hooks.SetNow(t, func() time.Time { return noon.UTC() })

			row := testutil.Row{
				Name:   "finished",
				As:     "alice",
				Method: http.MethodPatch,
				URL:    participations(p1),
				Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
					t.Helper()
					raceOn("2026-06-13", "", "")(t, app, fx)
					fx.Event.Set("date_precision", "month")
					fx.Event.Set("start_date", "2027-06-01")
					if err := app.Save(fx.Event); err != nil {
						t.Fatal(err)
					}
				},
				Body:   body(`{"status":"finished"}`),
				Status: tt.status,
			}
			if tt.status == http.StatusBadRequest {
				row.Contains = []string{fieldError("status", apperr.CodeStatusBeforeRace)}
			}
			testutil.RunRows(t, []testutil.Row{row})
		})
	}
}
