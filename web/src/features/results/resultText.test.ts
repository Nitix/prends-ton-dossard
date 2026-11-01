import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import type { ParticipationRecord } from "../../lib/types";
import { hasResult, resultParts } from "./resultText";

/** Intl separates numbers and units with several kinds of non-breaking spaces. */
const plain = (parts: string[]) => parts.map((part) => part.replace(/\s/g, " "));

const finished: ParticipationRecord = {
  id: "p",
  created: "",
  updated: "",
  collectionId: "",
  collectionName: "",
  runner: "r",
  event: "e",
  format: "f",
  status: "finished",
  added_by: "r",
  confirmed: true,
  // The server sends 0 and "" for what is not given.
  finish_time_s: 0,
  rank: 0,
  rank_of: 0,
  result_note: "",
};

describe("resultParts", () => {
  test("resultParts — temps, rang sur nombre, note", () => {
    const p = {
      ...finished,
      finish_time_s: 15150,
      rank: 12,
      rank_of: 340,
      result_note: "3e V1H",
    };

    expect(plain(resultParts(p, createFormatters("fr-FR"), fr))).toEqual([
      "4h 12min 30s",
      "12e sur 340",
      "3e V1H",
    ]);
    expect(plain(resultParts(p, createFormatters("en-GB"), en))).toEqual([
      "4h 12m 30s",
      "12th out of 340",
      "3e V1H",
    ]);
  });

  test("resultParts — rang sans nombre", () => {
    const p = { ...finished, rank: 12 };

    expect(plain(resultParts(p, createFormatters("fr-FR"), fr))).toEqual(["12e"]);
    expect(plain(resultParts({ ...p, rank: 1 }, createFormatters("fr-FR"), fr))).toEqual(["1er"]);
    expect(plain(resultParts(p, createFormatters("en-GB"), en))).toEqual(["12th"]);
  });

  test("resultParts — rien sans résultat", () => {
    expect(resultParts(finished, createFormatters("fr-FR"), fr)).toEqual([]);
    // A record the server has not given the fields of at all.
    const bare: ParticipationRecord = { ...finished };
    delete bare.finish_time_s;
    delete bare.rank;
    delete bare.rank_of;
    delete bare.result_note;
    expect(resultParts(bare, createFormatters("fr-FR"), fr)).toEqual([]);
  });

  test("resultParts — le nombre de classés seul ne dit rien, une note de blancs non plus", () => {
    const p = { ...finished, rank_of: 340, result_note: "   " };

    expect(resultParts(p, createFormatters("fr-FR"), fr)).toEqual([]);
  });

  test("resultParts — la note seule, un abandon par exemple", () => {
    const p: ParticipationRecord = {
      ...finished,
      status: "dnf",
      result_note: "abandon au km 30",
    };

    expect(resultParts(p, createFormatters("fr-FR"), fr)).toEqual(["abandon au km 30"]);
  });
});

describe("hasResult", () => {
  test("hasResult — un temps, un rang ou une note", () => {
    expect(hasResult({ ...finished, finish_time_s: 3600 })).toBe(true);
    expect(hasResult({ ...finished, rank: 3 })).toBe(true);
    expect(hasResult({ ...finished, result_note: "3e V1H" })).toBe(true);
  });

  test("hasResult — ni temps, ni rang, ni note (le nombre de classés ne compte pas)", () => {
    expect(hasResult(finished)).toBe(false);
    expect(hasResult({ ...finished, rank_of: 340 })).toBe(false);
    expect(hasResult({ ...finished, result_note: "  " })).toBe(false);
  });
});
