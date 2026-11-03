package testutil

import (
	"context"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/logger"
)

// RequestLogs returns what the request log of app holds once it has at least
// want entries (or after a few seconds). The logger writes in the background, a
// few seconds after the request: this writes what it holds at once.
//
// The test application turns the log off: set app.Settings().Logs.MaxDays
// first.
func RequestLogs(t testing.TB, app *tests.TestApp, want int) []*core.Log {
	t.Helper()
	handler, ok := app.Logger().Handler().(*logger.BatchHandler)
	if !ok {
		t.Fatalf("the logger is a %T, want PocketBase's batch handler", app.Logger().Handler())
	}
	blocking := context.WithValue(context.Background(), logger.BlockKey, true)

	deadline := time.Now().Add(5 * time.Second)
	for {
		if err := handler.WriteAll(blocking); err != nil {
			t.Fatal(err)
		}
		var logs []*core.Log
		if err := app.LogQuery().All(&logs); err != nil {
			t.Fatal(err)
		}
		if len(logs) >= want || time.Now().After(deadline) {
			return logs
		}
		time.Sleep(20 * time.Millisecond)
	}
}
