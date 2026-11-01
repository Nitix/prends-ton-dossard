import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { describeMerge, type MergeResult } from "./mergePreview";

const none: MergeResult = {
  movedFormats: 0,
  movedParticipations: 0,
  droppedParticipations: 0,
  clearedFormatDates: 0,
  movedComments: 0,
};

describe("describeMerge", () => {
  test("a counter of one is singular, in French", () => {
    expect(describeMerge({ ...none, movedFormats: 1 }, fr, "fr")).toEqual(["1 épreuve déplacée"]);
  });

  test("a counter of two is plural, in French", () => {
    expect(describeMerge({ ...none, movedFormats: 2 }, fr, "fr")).toEqual(["2 épreuves déplacées"]);
  });

  test("a duplicate participation that is removed, in English", () => {
    expect(describeMerge({ ...none, droppedParticipations: 1 }, en, "en")).toEqual([
      "1 duplicate participation removed",
    ]);
    expect(describeMerge({ ...none, droppedParticipations: 3 }, en, "en")).toEqual([
      "3 duplicate participations removed",
    ]);
  });

  test("a counter that is zero has no line, whatever the language", () => {
    expect(describeMerge(none, fr, "fr")).toEqual([]);
    expect(describeMerge(none, en, "en")).toEqual([]);
  });

  test("one line per counter that is not zero, in the order of the merge", () => {
    const all: MergeResult = {
      movedFormats: 2,
      movedParticipations: 5,
      droppedParticipations: 1,
      clearedFormatDates: 1,
      movedComments: 4,
    };
    expect(describeMerge(all, fr, "fr")).toEqual([
      "2 épreuves déplacées",
      "5 participations déplacées",
      "1 participation en double supprimée",
      "1 date d'épreuve effacée (hors des dates de l'événement)",
      "4 commentaires déplacés",
    ]);
    expect(describeMerge(all, en, "en")).toEqual([
      "2 races moved",
      "5 participations moved",
      "1 duplicate participation removed",
      "1 race date cleared (outside the event's dates)",
      "4 comments moved",
    ]);
  });

  test("describeMerge — commentaires déplacés", () => {
    expect(describeMerge({ ...none, movedComments: 1 }, fr, "fr")).toEqual([
      "1 commentaire déplacé",
    ]);
    expect(describeMerge({ ...none, movedComments: 3 }, fr, "fr")).toEqual([
      "3 commentaires déplacés",
    ]);
    expect(describeMerge({ ...none, movedComments: 1 }, en, "en")).toEqual(["1 comment moved"]);
    expect(describeMerge({ ...none, movedComments: 2 }, en, "en")).toEqual(["2 comments moved"]);
  });

  test("both counters of a merge of formats: two moved and one dropped", () => {
    // When the participation of the other format wins a duplicate, it moves and the loser is dropped.
    const result = { ...none, movedParticipations: 2, droppedParticipations: 1 };
    expect(describeMerge(result, fr, "fr")).toEqual([
      "2 participations déplacées",
      "1 participation en double supprimée",
    ]);
  });
});
