import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { instantOf } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type { CommentRecord, EventRecord, RunnerRecord } from "../../lib/types";

// The comments of the events: the page of an event shows its own, in the order
// they were written, and the home page the last few of all. Both ask for the
// author (and the home page for the event) in the same request: the `expand` of
// a relation.

/** A comment with the runner who wrote it. */
export type CommentView = { comment: CommentRecord; author: RunnerRecord };

/** A comment of the home page: it says which event it is on. */
export type LatestComment = CommentView & { event: EventRecord };

/** The comments of an event: one list under the `["comments"]` prefix that every change refreshes. */
export const commentsKey = (eventId: string) => ["comments", eventId] as const;

/** The last comments of all the events. */
export const LATEST_COMMENTS_KEY = ["comments", "latest"] as const;

/** How many comments the home page shows. */
const LATEST_COUNT = 5;

/**
 * PocketBase sets `created` and `updated` of a new record with two reads of the
 * clock, which can be a millisecond apart: a comment is only called edited
 * when it was changed more than this long after it was written.
 */
const EDIT_GRACE_MS = 1000;

/** Whether the author changed the comment after writing it. */
export function isEdited({ created, updated }: CommentRecord): boolean {
  return (
    instantOf(updated).epochMilliseconds - instantOf(created).epochMilliseconds > EDIT_GRACE_MS
  );
}

// What the server sends for `expand`. An expand that is empty is left out of
// the record, hence the `?`; but a comment cannot lose its author (a runner who
// has written one is never deleted) nor its event (its comments go with it).
type ExpandedComment = CommentRecord & {
  expand?: { author?: RunnerRecord; event?: EventRecord };
};

function toCommentView(record: ExpandedComment): CommentView {
  const author = record.expand?.author;
  if (!author) throw new Error(`comment ${record.id}: its author is missing from the answer`);
  return { comment: record, author };
}

function toLatestComment(record: ExpandedComment): LatestComment {
  const event = record.expand?.event;
  if (!event) throw new Error(`comment ${record.id}: its event is missing from the answer`);
  return { ...toCommentView(record), event };
}

/** The comments of an event, the oldest first. */
export function useComments(eventId: string): UseQueryResult<CommentView[]> {
  return useQuery({
    queryKey: commentsKey(eventId),
    queryFn: async () => {
      const records = await pb.collection("comments").getFullList<ExpandedComment>({
        filter: pb.filter("event = {:event}", { event: eventId }),
        sort: "created",
        expand: "author",
      });
      return records.map(toCommentView);
    },
  });
}

/** The 5 last comments of all the events, the newest first. */
export function useLatestComments(): UseQueryResult<LatestComment[]> {
  return useQuery({
    queryKey: LATEST_COMMENTS_KEY,
    queryFn: async () => {
      const { items } = await pb
        .collection("comments")
        .getList<ExpandedComment>(1, LATEST_COUNT, { sort: "-created", expand: "author,event" });
      return items.map(toLatestComment);
    },
  });
}

// The hooks below run a request, then make the two lists ask for the comments
// again (the page of the event, and the home page). The mutation lasts until
// they have the new data, so that the field that sent a comment is emptied when
// the comment is on the page.

/** Resolves once the lists that are on screen have their new data. */
function refresh(queryClient: QueryClient, eventId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: commentsKey(eventId) }),
    queryClient.invalidateQueries({ queryKey: LATEST_COMMENTS_KEY }),
  ]);
}

/** Writes a comment on the event: the server sets its author, to the runner of the user. */
export function useCreateComment(eventId: string): UseMutationResult<CommentRecord, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => pb.collection("comments").create<CommentRecord>({ event: eventId, body }),
    onSuccess: () => refresh(queryClient, eventId),
  });
}

/** Changes the text of a comment: only its author may. */
export function useUpdateComment(
  eventId: string,
): UseMutationResult<CommentRecord, Error, { id: string; body: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => pb.collection("comments").update<CommentRecord>(id, { body }),
    onSuccess: () => refresh(queryClient, eventId),
  });
}

/** Deletes a comment: its author may, and so may an admin. */
export function useDeleteComment(eventId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await pb.collection("comments").delete(id);
    },
    onSuccess: () => refresh(queryClient, eventId),
  });
}
