package mcp

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The messages of a refusal of the site, as the tools give them to the
// assistant (spec § 6.12): the site's own words, the field, and the code in
// parentheses, so that the assistant can correct its call and try again.

// messages are the messages of the codes that the tools can meet, by code: the
// ones of fr.errors (web/src/i18n/fr.ts), word for word
// (TestMessages_SameWordsAsTheSite reads them).
var messages = map[string]string{
	// Races and formats.
	"date_invalid":                        "Cette date n'est pas valide.",
	"end_before_start":                    "La date de fin est avant la date de début.",
	"registration_deadline_after_start":   "La date limite d'inscription doit être au plus tard le jour du début.",
	"registration_opening_after_start":    "L'ouverture des inscriptions doit être au plus tard le jour du début.",
	"registration_opening_after_deadline": "L'ouverture des inscriptions doit être au plus tard la date limite.",
	"format_date_month":                   "Une course dont seul le mois est connu n'a pas de date d'épreuve.",
	"month_start_invalid":                 "Pour une course dont seul le mois est connu, la date est le 1er du mois.",
	"format_date_out_of_range":            "La date de l'épreuve doit être comprise dans les dates de l'événement.",
	"format_other_event":                  "Cette épreuve appartient à un autre événement.",
	"format_measure_required":             "Indique au moins une distance, une durée ou un temps max.",
	"price_invalid":                       "Le prix se donne au centime près.",
	// Participations and results.
	"format_required":       "Il faut choisir une épreuve.",
	"status_before_race":    "La course n'a pas encore eu lieu.",
	"supporter_with_format": "Un supporteur ne court pas d'épreuve.",
	"rank_above_total":      "Le classement dépasse le nombre de classés.",
	// Rides and lodgings.
	"offer_seats_required":      "Indique le nombre de places, de 1 à 8.",
	"offer_seats_below_members": "Plus de personnes ont déjà une place.",
	"offer_full":                "Il n'y a plus de place.",
	"offer_owner_member":        "Tu proposes déjà ces places.",
	"offer_already_member":      "Cette personne a déjà une place de cette sorte pour cet événement.",
	"time_invalid":              "L'heure doit être de la forme 06:30.",
	// The admin.
	"last_admin":                     "Il doit toujours rester au moins un admin.",
	"runner_has_account":             "Impossible de supprimer ce coureur : il a un compte. Désactive le compte à la place.",
	"runner_has_participations":      "Impossible de supprimer ce coureur : il a encore des participations.",
	"race_type_in_use":               "Impossible de supprimer ce type : des épreuves l'utilisent encore.",
	"invitation_kind_mismatch":       "Ce lien ne permet pas cette opération. Demande-en un nouveau à l'admin.",
	"merge_same_record":              "Choisis deux éléments différents.",
	"merge_formats_different_events": "Ces deux épreuves ne sont pas du même événement.",
	// The files of the MCP server.
	"upload_invalid": "Cet envoi n'est pas valide, ou il a expiré.",
	// The notifications.
	"push_endpoint_invalid": "Cet appareil ne peut pas être enregistré pour les notifications.",
	"push_unavailable":      "Les notifications ne sont pas disponibles pour l'instant.",
	// Any request.
	"not_found": "Introuvable : il a peut-être été supprimé.",
	"forbidden": "Tu n'as pas le droit de faire ça.",
	// PocketBase's own validation codes, which the site knows.
	"validation_required":             "Ce champ est obligatoire.",
	"validation_not_unique":           "Cette valeur est déjà utilisée.",
	"validation_invalid_email":        "Cet email n'est pas valide.",
	"validation_invalid_url":          "Cette adresse web n'est pas valide.",
	"validation_invalid_old_password": "Le mot de passe actuel est incorrect.",
	"validation_min_text_constraint":  "Cette valeur est trop courte.",
	"validation_max_text_constraint":  "Ce texte est trop long.",
	"validation_values_mismatch":      "Les deux valeurs sont différentes.",
	// The photo's: the track says it in its own words (fieldMessages).
	"validation_file_size_limit":   "La photo est trop lourde : 5 Mo maximum.",
	"validation_invalid_mime_type": "Ce type d'image n'est pas accepté : JPEG, PNG ou WebP.",
}

// fieldMessages are the codes that a field says in its own words, by field and
// code, as fieldMessage of web/src/i18n/errors.ts: the photo of a runner is not
// the GPX track of a format (fr.format.gpxNotGpx, fr.format.gpxTooBig).
var fieldMessages = map[string]map[string]string{
	"gpx": {
		"validation_invalid_mime_type": "Ce fichier n'est pas une trace GPX.",
		"validation_file_size_limit":   "La trace est trop lourde : 10 Mo maximum.",
	},
	// The seats of an offer: the bound of the field (offers.seats, 9d_offers.go),
	// which the site has no words for. A car's own bound, 1 to 8, is a code of its
	// hooks (offer_seats_required).
	"seats": {
		"validation_max_number_constraint": "30 au plus.",
	},
}

// fieldNames are the French names of the fields of the site's collections.
// A field without one is named as the API names it.
var fieldNames = map[string]string{
	"name":                      "nom",
	"location":                  "lieu",
	"start_date":                "date de début",
	"end_date":                  "date de fin",
	"registration_url":          "lien d'inscription",
	"registration_deadline":     "date limite d'inscription",
	"registration_opening":      "ouverture des inscriptions",
	"registration_opening_time": "heure d'ouverture",
	"date_precision":            "précision de la date",
	"notes":                     "notes",
	"event":                     "course",
	"format":                    "épreuve",
	"race_type":                 "type de course",
	"date":                      "date de l'épreuve",
	"distance_km":               "distance",
	"duration_min":              "durée",
	"time_limit_min":            "temps max",
	"elevation_gain_m":          "D+",
	"price_eur":                 "prix",
	"route_url":                 "lien du parcours",
	"gpx":                       "trace",
	"runner":                    "coureur",
	"status":                    "statut",
	"finish_time_s":             "temps",
	"rank":                      "classement",
	"rank_of":                   "nombre de classés",
	"result_note":               "note du résultat",
	"body":                      "texte",
	"kind":                      "sorte",
	"place":                     "lieu",
	"seats":                     "places",
	"time":                      "heure",
	"url":                       "lien",
	"offer":                     "offre",
	"avatar":                    "photo",
	"label":                     "nom du type",
	"measures":                  "mesures",
	"role":                      "rôle",
	"disabled":                  "désactivé",
}

// The messages that are not the one of a code (spec § 6.12).
const (
	msgForbidden     = "Tu n'as pas le droit de faire ça."
	msgNotFoundRead  = "Introuvable : il a peut-être été supprimé."
	msgNotFoundWrite = "Introuvable, ou ce n'est pas à toi de le modifier."
	msgTooMany       = "Trop de demandes d'un coup : attends une minute avant de réessayer."
	msgSiteError     = "Le site a rencontré une erreur. Réessaie dans un instant."
	// msgTooManyRecords is the message of a read that stopped at its bound (limit):
	// it is no fault that passes, and trying again is no use.
	msgTooManyRecords = "Il y a trop d'enregistrements pour les lire d'un coup (plus de %d) : réessayer n'y changera rien. " +
		"Précise la demande si l'outil le permet (une autre année pour get_stats), sinon c'est une limite du serveur MCP."
	// msgRefused is the message of a code that has none: the code is what the
	// assistant can go on.
	msgRefused = "Le site a refusé (code %s)."
)

// describe turns an error of the API into the French text of a tool error (spec
// § 6.12); any other error is logged (without token) and becomes the generic
// message. subject names the request that a batch refused, from its index
// (apiError.Request): the tool builds it from its operations ("Épreuve 2
// (« Trail 15 km »)"); nil for a single request.
func describe(app core.App, err error, subject func(request int) string) error {
	return describeNamed(app, err, subject, nil)
}

// describeNamed is describe, for a record whose fields have names of their own,
// by field (an offer has a « jour du départ », not a « date de l'épreuve »): a
// field that names does not have is named as fieldNames names it.
func describeNamed(app core.App, err error, subject func(request int) string, names map[string]string) error {
	// A read that stopped at its bound: said as it is, with the collection in the
	// log.
	var many *tooManyError
	if errors.As(err, &many) {
		app.Logger().Warn("mcp: a read hit the bound", "error", err)
		return fmt.Errorf(msgTooManyRecords, many.Limit)
	}
	var refused *apiError
	if !errors.As(err, &refused) {
		// The errors of the package name a method and a path, never a header:
		// the session of an inner request is in none of them.
		app.Logger().Error("mcp: a tool failed", "error", err)
		return errors.New(msgSiteError)
	}
	if refused.Status >= http.StatusInternalServerError || refused.Status < http.StatusBadRequest {
		app.Logger().Error("mcp: the site failed a request of a tool", "error", refused.Error())
		return errors.New(msgSiteError)
	}

	// A read that the site finds malformed (a filter, a sort or an expand that a
	// change of the schema left behind) is a fault of the tool: it is not a right
	// that the person lacks, which is what the bare 400 of a creation says.
	if refused.Status == http.StatusBadRequest && refused.Method == http.MethodGet && refused.Code == "" && len(refused.Fields) == 0 {
		app.Logger().Error("mcp: a read was refused as malformed", "error", refused.Error(), "path", refused.Path)
		return errors.New(msgSiteError)
	}

	text := refused.text(names)
	if subject != nil && refused.Request >= 0 {
		text = subject(refused.Request) + ", " + lowerFirst(text)
	}
	return errors.New(text)
}

// text is the message of a refusal (a 4xx), with these names for the fields
// (nil: fieldNames).
func (e *apiError) text(names map[string]string) string {
	switch {
	case e.Status == http.StatusTooManyRequests:
		return msgTooMany
	case len(e.Fields) > 0:
		parts := make([]string, 0, len(e.Fields))
		for _, field := range slices.Sorted(maps.Keys(e.Fields)) {
			if name, ok := names[field]; ok {
				parts = append(parts, namedFieldText(name, field, e.Fields[field]))
				continue
			}
			parts = append(parts, fieldText(field, e.Fields[field]))
		}
		return strings.Join(parts, " ; ")
	case e.Status == http.StatusNotFound && e.Method == http.MethodGet:
		return msgNotFoundRead
	case e.Status == http.StatusNotFound:
		return msgNotFoundWrite
	case e.Code != "":
		return codeText(e.Code)
	case e.Status == http.StatusForbidden || e.Status == http.StatusBadRequest:
		// A bare 400 is the rule of a creation, which PocketBase checks by
		// trying the insert.
		return msgForbidden
	default:
		return fmt.Sprintf(msgRefused, strconv.Itoa(e.Status))
	}
}

// codeText is the message of a code and the code, or msgRefused.
func codeText(code string) string {
	if message, ok := messages[code]; ok {
		return message + " (" + code + ")"
	}
	return fmt.Sprintf(msgRefused, code)
}

// fieldText is the French name of the field and the message of its code, in
// the field's own words if it has some.
func fieldText(field, code string) string {
	name, ok := fieldNames[field]
	if !ok {
		name = field
	}
	return namedFieldText(name, field, code)
}

// namedFieldText is fieldText, with that name for the field.
func namedFieldText(name, field, code string) string {
	message, ok := fieldMessages[field][code]
	if !ok {
		message, ok = messages[code]
	}
	if !ok {
		return name + " : " + lowerFirst(fmt.Sprintf(msgRefused, code))
	}
	return name + " : " + lowerFirst(message) + " (" + code + ")"
}

// lowerFirst writes the first letter of s in lower case: the message goes on
// after a name.
func lowerFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToLower(r)) + s[size:]
}
