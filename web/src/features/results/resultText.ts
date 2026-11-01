import type { Messages } from "../../i18n/fr";
import type { Formatters } from "../../lib/format";
import type { ParticipationRecord } from "../../lib/types";

// The result of a participation, as the server sends it: `0` and `""` for what
// is not given (see lib/types.ts), so each part is tested for truthiness.

/** The note, with the blanks around it gone: a note of blanks is no note. */
function noteOf(p: ParticipationRecord): string {
  return p.result_note?.trim() ?? "";
}

/**
 * Whether the participation has a result worth showing: a time, a rank or a
 * note. The number of people ranked alone is not one.
 */
export function hasResult(p: ParticipationRecord): boolean {
  return !!p.finish_time_s || !!p.rank || noteOf(p) !== "";
}

/**
 * What is known of the result, as the parts of a line to be joined with a
 * separator: the time ("4h 12min 30s"), the rank, with how many were ranked
 * when it is known ("12e sur 340", or "12e"), then the note. A part that is
 * not given is left out: nothing at all without a result.
 */
export function resultParts(p: ParticipationRecord, f: Formatters, t: Messages): string[] {
  const parts: string[] = [];
  if (p.finish_time_s) parts.push(f.raceTime(p.finish_time_s));
  if (p.rank)
    parts.push(t.results.rankText(f.ordinal(p.rank), p.rank_of ? String(p.rank_of) : undefined));
  const note = noteOf(p);
  if (note !== "") parts.push(note);
  return parts;
}
