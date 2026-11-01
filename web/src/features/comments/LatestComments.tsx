import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { useLatestComments } from "./api";
import { excerpt } from "./excerpt";
import { RelativeTime } from "./RelativeTime";

/**
 * « Derniers commentaires »: the 5 newest comments of all the events, each with
 * its author, its event (a link to its page), the beginning of its text and
 * when it was written. It is only a way to find out that somebody wrote
 * something: it is not there while the comments load, when they fail to load,
 * or when there are none.
 */
export function LatestComments() {
  const { t } = useI18n();
  const headingId = useId();
  const { data } = useLatestComments();

  if (!data || data.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.home.latestCommentsTitle}
      </h2>
      <ul className="flex flex-col gap-2">
        {data.map(({ comment, author, event }) => (
          <li
            key={comment.id}
            className="flex flex-col rounded-lg border-2 border-neutral-200 bg-white p-3"
          >
            <p>
              {t.home.commentOn(
                <strong className="font-medium">{author.name}</strong>,
                <Link
                  to="/evenements/$id"
                  params={{ id: event.id }}
                  className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline"
                >
                  {event.name}
                </Link>,
              )}
            </p>
            <p className="break-words">{excerpt(comment.body)}</p>
            <p className="text-sm text-neutral-600">
              <RelativeTime at={comment.created} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
