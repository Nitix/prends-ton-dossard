import { describe, expect, test } from "vitest";

import type { FormatRecord, ParticipationRecord, RunnerRecord } from "../../lib/types";
import {
  aliceRunner,
  bobRunner,
  eventRecord,
  f15,
  f42,
  fLyon,
  p1,
  roadType,
  trailType,
} from "../events/testFixture";
import {
  byRunner,
  byYear,
  toResultRow,
  totalsOf,
  type ResultRecord,
  type ResultRow,
} from "./stats";

const date = (s: string) => Temporal.PlainDate.from(s);

type Overrides = Partial<Omit<ParticipationRecord, "runner" | "format">> & {
  runner?: RunnerRecord;
  format?: FormatRecord;
};

/**
 * A result of the fixture: Alice on the trail of 42 km (2 400 m) by default,
 * finished, on this day. The `ParticipationRecord` says the runner by its id,
 * the row has the record of the runner.
 */
function rowOf(id: string, day: string, overrides: Overrides = {}): ResultRow {
  const { runner = aliceRunner, format = f42, ...participation } = overrides;
  const raceType = format === fLyon ? roadType : trailType;
  return {
    participation: {
      ...p1,
      id,
      runner: runner.id,
      format: format.id,
      status: "finished",
      finish_time_s: 0,
      ...participation,
    },
    runner,
    event: eventRecord,
    format,
    raceType,
    date: date(day),
  };
}

const ZERO = { finished: 0, dnf: 0, km: 0, elevation: 0, seconds: 0 };

describe("totalsOf", () => {
  test("totalsOf — une course terminée compte sa distance, son D+ et son temps", () => {
    const rows = [
      rowOf("a", "2026-06-14", { finish_time_s: 15_150 }),
      rowOf("b", "2026-06-13", { format: f15, finish_time_s: 5_400 }),
    ];

    expect(totalsOf(rows)).toEqual({
      finished: 2,
      dnf: 0,
      km: 57,
      elevation: 3_100,
      seconds: 20_550,
    });
  });

  test("totalsOf — sans rien", () => {
    expect(totalsOf([])).toEqual(ZERO);
  });

  test("totalsOf — ce qui n'est pas renseigné compte pour rien: pas de temps, pas de distance, pas de D+", () => {
    // The API sends 0 for a measure that is not given, and a timed race has no distance.
    const timed = { ...f42, distance_km: 0, elevation_gain_m: 0, duration_min: 360 };
    const rows = [
      rowOf("no-time", "2026-06-14", { finish_time_s: 0 }),
      rowOf("timed", "2026-06-14", { format: timed, finish_time_s: 21_600 }),
    ];

    expect(totalsOf(rows)).toEqual({
      finished: 2,
      dnf: 0,
      km: 42,
      elevation: 2_400,
      seconds: 21_600,
    });
  });

  test("totalsOf — les distances décimales s'additionnent sans bruit de flottants", () => {
    const rows = ["0.1", "0.2"].map((km, i) =>
      rowOf(`r${i}`, "2026-06-14", { format: { ...f42, distance_km: Number(km) } }),
    );

    expect(totalsOf(rows).km).toBe(0.3);
  });

  test("stats — un abandon ne compte que dans les abandons", () => {
    // A time on a DNF is a leftover that the server clears: the totals do not rely on it.
    const dnf = rowOf("dnf", "2026-06-14", { status: "dnf", finish_time_s: 3_600 });

    expect(totalsOf([dnf])).toEqual({ ...ZERO, dnf: 1 });
    expect(totalsOf([dnf, rowOf("done", "2026-06-13", { finish_time_s: 900 })])).toEqual({
      finished: 1,
      dnf: 1,
      km: 42,
      elevation: 2_400,
      seconds: 900,
    });
  });

  test("totalsOf — un autre statut ne compte pour rien", () => {
    const rows = (["registered", "interested", "dns", "supporter"] as const).map((status) =>
      rowOf(status, "2026-06-14", { status }),
    );

    expect(totalsOf(rows)).toEqual(ZERO);
  });
});

describe("byRunner", () => {
  test("byRunner — seulement l'année demandée, triés par km puis nom", () => {
    const zoe = { ...bobRunner, id: "zoeRunner000000", name: "Zoé" };
    const rows = [
      // Alice, 2026: 42 km.
      rowOf("a1", "2026-06-14"),
      // Bob, 2026: 57 km, over two races.
      rowOf("b1", "2026-03-01", { runner: bobRunner }),
      rowOf("b2", "2026-09-20", { runner: bobRunner, format: f15 }),
      // Zoé, 2026: 42 km too, like Alice: the name decides.
      rowOf("z1", "2026-05-10", { runner: zoe }),
      // Another year: left out, with the runner who has nothing else.
      rowOf("a0", "2025-06-14"),
      rowOf("s0", "2025-06-14", { runner: { ...bobRunner, id: "samRunner000000", name: "Sam" } }),
      rowOf("a2", "2027-01-01"),
    ];

    const list = byRunner(rows, 2026);

    expect(list.map(({ runner }) => runner.name)).toEqual(["Bob", "Alice", "Zoé"]);
    expect(list.map(({ totals }) => totals.km)).toEqual([57, 42, 42]);
    expect(list[0]?.totals).toEqual({ ...ZERO, finished: 2, km: 57, elevation: 3_100 });
  });

  test("byRunner — un coureur qui n'a que des abandons est là, à 0 km", () => {
    const rows = [rowOf("a1", "2026-06-14", { status: "dnf" })];

    expect(byRunner(rows, 2026)).toEqual([{ runner: aliceRunner, totals: { ...ZERO, dnf: 1 } }]);
  });

  test("byRunner — la date de l'épreuve donne l'année, pas celle de l'événement", () => {
    // The day of the format is on 1 January, the event began on 31 December.
    const rows = [rowOf("a1", "2027-01-01")];

    expect(byRunner(rows, 2026)).toEqual([]);
    expect(byRunner(rows, 2027)).toHaveLength(1);
  });

  test("byRunner — sans résultat cette année-là, rien", () => {
    expect(byRunner([], 2026)).toEqual([]);
  });
});

describe("byYear", () => {
  test("byYear — années décroissantes", () => {
    const rows = [
      rowOf("a", "2024-06-14", { finish_time_s: 100 }),
      rowOf("b", "2026-06-14", { finish_time_s: 200 }),
      rowOf("c", "2025-06-14", { status: "dnf" }),
      rowOf("d", "2026-09-01", { format: f15, finish_time_s: 50 }),
    ];

    const years = byYear(rows);

    expect(years.map(({ year }) => year)).toEqual([2026, 2025, 2024]);
    expect(years[0]?.totals).toEqual({
      finished: 2,
      dnf: 0,
      km: 57,
      elevation: 3_100,
      seconds: 250,
    });
    expect(years[1]?.totals).toEqual({ ...ZERO, dnf: 1 });
  });

  test("byYear — sans résultat, rien", () => {
    expect(byYear([])).toEqual([]);
  });
});

describe("toResultRow", () => {
  const record: ResultRecord = {
    ...p1,
    status: "finished",
    format: f42.id,
    expand: { runner: aliceRunner, event: eventRecord, format: f42 },
  };
  const missing = (key: "runner" | "event" | "format") =>
    toResultRow({ ...record, expand: { ...record.expand, [key]: undefined } });

  test("toResultRow — le coureur, l'événement, l'épreuve et son type, et le jour de l'épreuve", () => {
    const row = toResultRow({ ...record, expand: { ...record.expand, format: { ...f42 } } });

    expect(row.runner).toBe(aliceRunner);
    expect(row.event).toBe(eventRecord);
    expect(row.raceType).toBe(trailType);
    expect(row.date.toString()).toBe("2026-06-14");
    // A format with no date of its own is on the day its event starts.
    const noDate = toResultRow({ ...record, expand: { ...record.expand, format: f15 } });
    expect(noDate.date.toString()).toBe("2026-06-13");
  });

  test("toResultRow — une réponse sans coureur, événement ou épreuve est une erreur", () => {
    expect(() => missing("runner")).toThrow(/runner/);
    expect(() => missing("event")).toThrow(/event/);
    expect(() => missing("format")).toThrow(/format/);
    expect(() => toResultRow({ ...record, expand: undefined })).toThrow(/runner/);
  });
});
