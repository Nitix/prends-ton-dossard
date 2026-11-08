import type { Lang } from "../../i18n/detect";
import type { Messages } from "../../i18n/fr";
import { plural } from "../../i18n/plural";

/**
 * What a merge did, or would do for a dry run: the answer of `merge-events`
 * and `merge-formats` (server/admin/merge.go).
 */
export type MergeResult = {
  /** The formats that went to the kept event. */
  movedFormats: number;
  /**
   * The participations that went to the kept format, or that the formats
   * moved to the kept event carry. When the participation of the merged
   * format wins a duplicate it counts here, and the other one as dropped.
   */
  movedParticipations: number;
  /**
   * The participations deleted as duplicates. Merging formats: the one that
   * loses, for a runner who is on both formats. Merging events: the one with
   * no format of a runner who already is in the kept event on a format, or who
   * gets a format by the merge; and, for a runner with no format in both events,
   * the one that loses.
   */
  droppedParticipations: number;
  /** The formats that lost their own date, which fell outside the dates of the kept event. */
  clearedFormatDates: number;
  /** The formats that lost their start time, which a race known by its month does not have. */
  clearedFormatTimes: number;
  /** The comments of the merged event that went to the kept event: a merge of formats moves none. */
  movedComments: number;
  /** The offers (cars and lodgings) of the merged event that went to the kept event, with their places: a merge of formats moves none. */
  movedOffers: number;
};

/** The counters, in the order a merge goes through them. */
const COUNTERS = [
  "movedFormats",
  "movedParticipations",
  "droppedParticipations",
  "clearedFormatDates",
  "clearedFormatTimes",
  "movedComments",
  "movedOffers",
] as const satisfies readonly (keyof MergeResult)[];

/**
 * What a merge does, in words: one line per counter that is not zero ("2
 * épreuves déplacées"). There is none when nothing moves, which is not the
 * same as there being nothing to say: the page tells it.
 */
export function describeMerge(r: MergeResult, t: Messages, lang: Lang): string[] {
  return COUNTERS.filter((counter) => r[counter] > 0).map(
    (counter) => `${r[counter]} ${plural(lang, r[counter], t.admin.mergeCount[counter])}`,
  );
}
