package migrations

import (
	"fmt"
	"regexp"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upRaceTypeMeasures, downRaceTypeMeasures)
}

// raceTypeMeasures are the four measures of a format that a race type can say it
// uses, in the order the form shows them.
var raceTypeMeasures = []string{"distance", "elevation", "duration", "time_limit"}

// upRaceTypeMeasures adds `measures` to the race types: the measures that the
// form of a format shows first for a format of that type, the others going into
// its « Options avancées ». The field is not required, and an empty one means all
// four: a type made later, or by a member of the group who never opens the admin
// pages, shows the whole form, as it always did.
//
// The types that exist when the migration runs are started from their name
// (see defaultMeasures), since the six that every installation has are known
// and an admin would otherwise have to set each one. The rules of the collection
// stay the ones of the migration 4: any signed-in member reads the field, and
// only an admin writes it. The server does not check a format against the
// measures of its type: a format still needs a distance, a duration or a time
// limit, whatever the type says (see events.validateFormat).
func upRaceTypeMeasures(app core.App) error {
	raceTypes, err := app.FindCollectionByNameOrId("race_types")
	if err != nil {
		return err
	}
	raceTypes.Fields.Add(&core.SelectField{
		Name:      "measures",
		Values:    raceTypeMeasures,
		MaxSelect: len(raceTypeMeasures),
	})
	if err := app.Save(raceTypes); err != nil {
		return fmt.Errorf("race_types: %w", err)
	}

	records, err := app.FindAllRecords("race_types")
	if err != nil {
		return err
	}
	for _, record := range records {
		measures := defaultMeasures(record.GetString("label"))
		if len(measures) == 0 {
			continue
		}
		record.Set("measures", measures)
		if err := app.Save(record); err != nil {
			return fmt.Errorf("race type %q: %w", record.GetString("label"), err)
		}
	}
	return nil
}

// downRaceTypeMeasures removes the field, with the choices that it holds. The
// types stay, and so does every format.
func downRaceTypeMeasures(app core.App) error {
	raceTypes, err := app.FindCollectionByNameOrId("race_types")
	if err != nil {
		return err
	}
	raceTypes.Fields.RemoveByName("measures")
	if err := app.Save(raceTypes); err != nil {
		return fmt.Errorf("race_types: %w", err)
	}
	return nil
}

var (
	// folded writes the French letters that carry an accent without it.
	folded = strings.NewReplacer(
		"à", "a", "â", "a", "ä", "a", "á", "a",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"î", "i", "ï", "i", "í", "i",
		"ô", "o", "ö", "o", "ó", "o", "œ", "oe",
		"ù", "u", "û", "u", "ü", "u", "ú", "u",
		"ç", "c", "ñ", "n", "æ", "ae",
		// A hyphen, an apostrophe or an underscore separates words, as a space does.
		"-", " ", "_", " ", "'", " ", "’", " ",
	)
	// hoursLabel finds a duration in the name of a type: « 6 heures », « 24h »,
	// « 12 h », « 6h30 » (a number, then an « h » that is not the start of a
	// word), « chrono(métré) », « en durée », « contre-la-montre ».
	hoursLabel = regexp.MustCompile(`(?:^|[^a-z0-9])\d+ ?h(?:[^a-z]|$)|\bheures?\b|\bchrono|\bduree\b|\bcontre la montre\b`)
)

// defaultMeasures are the measures that a race type of that label starts with,
// or none when its name does not say. The label is compared in lower case,
// without accents, and with a space for a hyphen. The first rule that matches
// wins:
//
//   - a name with « backyard » (a race with a cut-off at the end of every
//     lap): the time limit;
//   - a name with « hyrox »: the distance;
//   - a name that is a duration (hoursLabel), even one with « trail » in it:
//     the duration;
//   - « route », « ultra », « cross », « course nature », or any name with
//     « trail » in it: the distance, its elevation gain and its time limit.
//
// « cross » and « route » are only the type itself: « Canicross » is not
// started, and nor is a name that has the word in it by chance.
func defaultMeasures(label string) []string {
	name := strings.Join(strings.Fields(folded.Replace(strings.ToLower(label))), " ")
	switch {
	case strings.Contains(name, "backyard"):
		return []string{"time_limit"}
	case strings.Contains(name, "hyrox"):
		return []string{"distance"}
	case hoursLabel.MatchString(name):
		return []string{"duration"}
	case name == "route", name == "ultra", name == "cross", name == "course nature", strings.Contains(name, "trail"):
		return []string{"distance", "elevation", "time_limit"}
	}
	return nil
}
