package apperr

// The codes of the errors that the server answers, which the front end maps to
// its messages. This is the only list of them. The front end reads this file to
// check its messages: keep each constant on its own line, as a name, an equals
// sign and the quoted code, and quote nothing else with an equals sign here.
const (
	CodeInvitationInvalid              = "invitation_invalid"
	CodeInvitationKindMismatch         = "invitation_kind_mismatch"
	CodeEmailTaken                     = "email_taken"
	CodeEmailInvalid                   = "email_invalid"
	CodeWrongPassword                  = "wrong_password"
	CodePasswordTooShort               = "password_too_short"
	CodePasswordMismatch               = "password_mismatch"
	CodeLastAdmin                      = "last_admin"
	CodeRunnerHasParticipations        = "runner_has_participations"
	CodeRunnerHasAccount               = "runner_has_account"
	CodeRaceTypeInUse                  = "race_type_in_use"
	CodeDateInvalid                    = "date_invalid"
	CodeEndBeforeStart                 = "end_before_start"
	CodeRegistrationDeadlineAfterStart = "registration_deadline_after_start"
	CodeFormatDateOutOfRange           = "format_date_out_of_range"
	CodeFormatOtherEvent               = "format_other_event"
	CodeFormatMeasureRequired          = "format_measure_required"
	CodePriceInvalid                   = "price_invalid"
	CodeFormatRequired                 = "format_required"
	CodeSupporterWithFormat            = "supporter_with_format"
	CodeOfferSeatsRequired             = "offer_seats_required"
	CodeOfferSeatsBelowMembers         = "offer_seats_below_members"
	CodeOfferFull                      = "offer_full"
	CodeOfferOwnerMember               = "offer_owner_member"
	CodeOfferAlreadyMember             = "offer_already_member"
	CodeTimeInvalid                    = "time_invalid"
	CodeMergeSameRecord                = "merge_same_record"
	CodeMergeFormatsDifferentEvents    = "merge_formats_different_events"
	CodeNotFound                       = "not_found"
	CodeForbidden                      = "forbidden"
	CodePasskeyFailed                  = "passkey_failed"
	CodePasskeySessionExpired          = "passkey_session_expired"
	CodeAccountDisabled                = "account_disabled"
)
