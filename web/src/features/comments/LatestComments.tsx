import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { BlockTitle } from "../../components/BlockTitle";
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
    <section
      aria-labelledby={headingId}
      data-block="comments"
      className="page-block flex flex-col gap-3"
    >
      <BlockTitle id={headingId}>{t.home.latestCommentsTitle}</BlockTitle>
      <ul className="flex flex-col gap-2">
        {data.map(({ comment, author, event }) => (
          <li
            key={comment.id}
            className="latest-comment card relative flex flex-col gap-1 overflow-hidden p-4 pl-5"
          >
            <span
              aria-hidden="true"
              className="latest-comment-mark absolute inset-y-4 left-0 w-1 rounded-r-full bg-dawn"
            />
            <p className="text-sm text-neutral-700">
              {t.home.commentOn(
                <strong className="font-semibold text-ink">{author.name}</strong>,
                <Link
                  to="/evenements/$id"
                  params={{ id: event.id }}
                  className="inline-flex min-h-11 items-center font-semibold text-iris-700 underline-offset-4 hover:underline"
                >
                  {event.name}
                </Link>,
              )}
            </p>
            <p className="break-words text-ink">{excerpt(comment.body)}</p>
            <p className="text-xs font-medium text-neutral-600">
              <RelativeTime at={comment.created} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
