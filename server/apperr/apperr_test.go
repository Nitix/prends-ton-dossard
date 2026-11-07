package apperr_test

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"slices"
	"testing"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
)

func TestNew(t *testing.T) {
	err := apperr.New(http.StatusConflict, apperr.CodeLastAdmin)

	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) {
		t.Fatalf("want a *router.ApiError, got %T", err)
	}
	if apiErr.Status != http.StatusConflict {
		t.Errorf("status = %d, want %d", apiErr.Status, http.StatusConflict)
	}
	if got := apiErr.Data["code"]; got != "last_admin" {
		t.Errorf("data.code = %v, want last_admin", got)
	}
	if len(apiErr.Data) != 1 {
		t.Errorf("data = %v, want the code only", apiErr.Data)
	}
}

func TestField(t *testing.T) {
	err := apperr.Field("end_date", apperr.CodeEndBeforeStart)

	var errs validation.Errors
	if !errors.As(err, &errs) {
		t.Fatalf("want validation.Errors, got %T", err)
	}
	fieldErr, ok := errs["end_date"].(validation.Error)
	if !ok || fieldErr.Code() != "end_before_start" {
		t.Errorf("errs = %v, want end_date: end_before_start", errs)
	}

	// What the API makes of it: data.<field>.code.
	apiErr := router.NewBadRequestError("", err)
	field, ok := apiErr.Data["end_date"].(map[string]any)
	if !ok || field["code"] != "end_before_start" {
		t.Errorf("api data = %v, want end_date.code = end_before_start", apiErr.Data)
	}
}

// The front end parses codes.go with /= "([a-z_]+)"/g to learn the codes: each
// constant must stay on its own line, and nothing else may match.
func TestCodes_FrontEndContract(t *testing.T) {
	source, err := os.ReadFile("codes.go")
	if err != nil {
		t.Fatal(err)
	}

	var got []string
	for _, m := range regexp.MustCompile(`= "([a-z_]+)"`).FindAllStringSubmatch(string(source), -1) {
		got = append(got, m[1])
	}
	slices.Sort(got)

	want := []string{
		"account_disabled", "date_invalid", "email_invalid", "email_taken", "end_before_start",
		"forbidden", "format_date_month", "format_date_out_of_range", "format_measure_required", "format_other_event",
		"format_required", "invitation_invalid", "invitation_kind_mismatch", "last_admin",
		"merge_formats_different_events", "merge_same_record", "month_start_invalid", "not_found",
		"offer_already_member", "offer_full", "offer_owner_member", "offer_seats_below_members",
		"offer_seats_required",
		"passkey_failed", "passkey_session_expired", "password_mismatch", "password_too_short", "price_invalid",
		"push_endpoint_invalid", "push_unavailable",
		"race_type_in_use", "rank_above_total", "registration_deadline_after_start", "registration_opening_after_deadline",
		"registration_opening_after_start", "runner_has_account",
		"runner_has_participations", "status_before_race", "supporter_with_format", "time_invalid",
		"token_invalid", "token_limit", "upload_invalid", "weather_unavailable", "wrong_password",
	}
	if !slices.Equal(got, want) {
		t.Errorf("codes in codes.go:\n got %v\nwant %v", got, want)
	}
}
