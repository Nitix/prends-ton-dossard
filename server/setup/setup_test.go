package setup_test

import (
	"reflect"
	"testing"

	"courses/server/testutil"
)

// The nightly backup (0 3 * * *, see migrations/3_settings.go) must run at 3 h
// in Paris, as the README says: PocketBase's cron runs on UTC unless told
// otherwise. The cron does not expose its time zone, so the test reads it.
func TestRegister_CronRunsOnParisTime(t *testing.T) {
	app := testutil.NewApp(t) // calls setup.Register

	timezone := reflect.ValueOf(app.Cron()).Elem().FieldByName("timezone")
	if !timezone.IsValid() || timezone.Kind() != reflect.Pointer {
		t.Fatal("cron.Cron has no timezone field any more: read the time zone another way")
	}
	if timezone.IsNil() {
		t.Fatal("the cron has no time zone")
	}
	if got := timezone.Elem().FieldByName("name").String(); got != "Europe/Paris" {
		t.Errorf("the cron runs on %q, want Europe/Paris", got)
	}
}
