import { expect, test } from "vitest";

import { MEASURES, measuresOf, shownMeasures } from "./measures";
import type { Measure, RaceTypeRecord } from "./types";

/** A race type as the API sends it, a JSON text: `measures` is an empty list for a type that has chosen none, and may hold any text. */
function raceType(measures?: string[]): RaceTypeRecord {
  const sent: RaceTypeRecord = JSON.parse(
    JSON.stringify({
      id: "type",
      created: "",
      updated: "",
      collectionId: "",
      collectionName: "race_types",
      label: "Trail",
      ...(measures === undefined ? {} : { measures }),
    }),
  );
  return sent;
}

const ALL: Measure[] = ["distance", "elevation", "duration", "time_limit"];

test("measuresOf — un type sans choix, ou pas de type du tout, utilise les quatre mesures", () => {
  expect(MEASURES).toEqual(ALL);
  expect(measuresOf(undefined)).toEqual(ALL);
  // The field is missing until the migration has run, and empty until an admin chooses.
  expect(measuresOf(raceType())).toEqual(ALL);
  expect(measuresOf(raceType([]))).toEqual(ALL);
});

test("measuresOf — les mesures choisies, dans l'ordre habituel, sans ce que le formulaire ne connaît pas", () => {
  expect(measuresOf(raceType(["time_limit", "distance"]))).toEqual(["distance", "time_limit"]);
  expect(measuresOf(raceType(["elevation", "speed", "elevation"]))).toEqual(["elevation"]);
  // A list with nothing the form knows is as good as none.
  expect(measuresOf(raceType(["speed"]))).toEqual(ALL);
});

test("shownMeasures — une épreuve se mesure toujours : sans distance, durée ni temps max, la distance est montrée aussi", () => {
  expect(shownMeasures(raceType(["time_limit"]))).toEqual(["time_limit"]);
  expect(shownMeasures(raceType(["distance", "elevation"]))).toEqual(["distance", "elevation"]);
  expect(shownMeasures(raceType(["elevation"]))).toEqual(["distance", "elevation"]);
  expect(shownMeasures(undefined)).toEqual(ALL);
});
