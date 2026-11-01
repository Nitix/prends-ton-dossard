import { describe, expect, test } from "vitest";

import type { CommentRecord } from "../../lib/types";
import { commentsKey, isEdited, LATEST_COMMENTS_KEY } from "./api";

function record(created: string, updated: string): CommentRecord {
  return {
    id: "c1",
    created,
    updated,
    collectionId: "",
    collectionName: "comments",
    event: "event",
    author: "alice",
    body: "Bonjour",
  };
}

describe("isEdited", () => {
  // PocketBase reads the clock once for `created` and once for `updated` when
  // it saves a record: a new comment can have them a millisecond apart.
  test("isEdited — 1 ms d'écart à la création n'est pas une modification", () => {
    expect(isEdited(record("2026-11-01 04:30:22.123Z", "2026-11-01 04:30:22.123Z"))).toBe(false);
    expect(isEdited(record("2026-11-01 04:30:22.999Z", "2026-11-01 04:30:23.000Z"))).toBe(false);
  });

  test("isEdited — la limite est de plus d'une seconde", () => {
    expect(isEdited(record("2026-11-01 04:30:22.000Z", "2026-11-01 04:30:23.000Z"))).toBe(false);
    expect(isEdited(record("2026-11-01 04:30:22.000Z", "2026-11-01 04:30:23.001Z"))).toBe(true);
  });

  test("isEdited — 2 minutes d'écart est une modification", () => {
    expect(isEdited(record("2026-11-01 04:30:22.123Z", "2026-11-01 04:32:22.123Z"))).toBe(true);
  });
});

describe("keys", () => {
  test("the comments of an event, and the latest ones, are two lists under one prefix", () => {
    expect(commentsKey("event1")).toEqual(["comments", "event1"]);
    expect(LATEST_COMMENTS_KEY).toEqual(["comments", "latest"]);
  });
});
