import { describe, expect, test } from "vitest";

import { toEventViews } from "../events/api";
import { eventRecord, f15, f42, p1, p2, roadType, trailType } from "../events/testFixture";
import { upcomingOf } from "./MyUpcoming";

const date = (s: string) => Temporal.PlainDate.from(s);

/** The runner of Alice's participations in the fixture. */
const ALICE = p1.runner;

const ids = (views: ReturnType<typeof toEventViews>, today: string) =>
  upcomingOf(views, ALICE, date(today)).map(({ participation }) => participation.id);

/** An event of June 2027 known by its month only, with Alice on its format (no day) or on the event. */
function juneEvent(id: string, name: string, extra: object = {}) {
  return {
    ...eventRecord,
    id,
    name,
    start_date: "2027-06-01",
    end_date: "2027-06-30",
    date_precision: "month",
    expand: {
      formats_via_event: [
        {
          ...f15,
          id: `${id}-f`,
          event: id,
          date: "",
          race_type: roadType.id,
          expand: { race_type: roadType },
        },
      ],
      participations_via_event: [
        {
          ...p1,
          id: `${id}-p`,
          event: id,
          format: `${id}-f`,
          status: "interested",
          expand: p1.expand,
        },
      ],
    },
    ...extra,
  };
}

/** An event with a day, with Alice interested in one of its formats. */
const datedEvent = (id: string, day: string) => ({
  ...eventRecord,
  id,
  name: id,
  start_date: day,
  end_date: "",
  expand: {
    formats_via_event: [
      { ...f42, id: `${id}-f`, event: id, date: "", expand: { race_type: trailType } },
    ],
    participations_via_event: [
      { ...p1, id: `${id}-p`, event: id, format: `${id}-f`, expand: p1.expand },
    ],
  },
});

describe("upcomingOf, une course au mois", () => {
  test("MyUpcoming — une course au mois reste jusqu'à la fin du mois", () => {
    const views = toEventViews([juneEvent("june", "Trail de juin")]);

    // The 1st is behind from the 2nd, and the race stays: its day is not known.
    expect(ids(views, "2027-05-20")).toEqual(["june-p"]);
    expect(ids(views, "2027-06-01")).toEqual(["june-p"]);
    expect(ids(views, "2027-06-15")).toEqual(["june-p"]);
    expect(ids(views, "2027-06-30")).toEqual(["june-p"]);
    expect(ids(views, "2027-07-01")).toEqual([]);
  });

  test("MyUpcoming — le jour affiché est le 1er, le dernier jour du mois range la course", () => {
    const views = toEventViews([juneEvent("june", "Trail de juin")]);

    const [first] = upcomingOf(views, ALICE, date("2027-06-10"));
    expect(first?.lastDay.toString()).toBe("2027-06-30");
    expect(first?.date.toString()).toBe("2027-06-01");
  });

  test("MyUpcoming — une participation à la course seule suit la même règle", () => {
    const alone = juneEvent("alone", "Cross de juin", {
      expand: {
        formats_via_event: [],
        participations_via_event: [
          {
            ...p2,
            id: "alone-p",
            runner: ALICE,
            event: "alone",
            format: "",
            status: "supporter",
            expand: p1.expand,
          },
        ],
      },
    });
    const views = toEventViews([alone]);

    expect(ids(views, "2027-06-30")).toEqual(["alone-p"]);
    expect(ids(views, "2027-07-01")).toEqual([]);
  });

  test("MyUpcoming — à la fin du mois, après les courses du mois qui ont un jour", () => {
    // A race dated on the 20th of June, and one that is known by its month: the
    // dated one comes first, whatever the names; one on the 30th too.
    const views = toEventViews([
      juneEvent("a-month", "A trail de juin"),
      datedEvent("the-30th", "2027-06-30"),
      datedEvent("the-20th", "2027-06-20"),
      datedEvent("july", "2027-07-02"),
    ]);

    expect(ids(views, "2027-06-10")).toEqual(["the-20th-p", "the-30th-p", "a-month-p", "july-p"]);
  });
});
