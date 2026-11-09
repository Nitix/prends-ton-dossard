import { useId } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { useI18n } from "../../i18n/I18nProvider";
import type { Formatters } from "../../lib/format";
import type { Invitation, PreviewLine } from "./InvitationPage";

/**
 * What waits behind an invitation link, kept light: the races of the person
 * invited as a plain list (with the friends going), then the races of the group
 * in one sentence. Each part is absent when it has nothing to show; with no race
 * of their own, the sentence says the group goes rather than « also goes ».
 */
export function InvitationPreview({ invitation }: { invitation: Invitation }) {
  const { t, f } = useI18n();
  const mine = invitation.upcoming?.races ?? [];
  const total = invitation.upcoming?.total ?? 0;
  const group = invitation.group ?? [];

  const groupList = f.list(group.map((line) => `${line.event} (${shortWhen(line, true, f)})`));

  return (
    <>
      {mine.length > 0 && <RaceList lines={mine} total={total} />}
      {group.length > 0 && (
        <p className="text-sm">
          {mine.length > 0 ? t.auth.groupAlso(groupList) : t.auth.groupOnly(groupList)}
        </p>
      )}
    </>
  );
}

/** The day of a race (« sam. 14 nov. », or « 14 nov. » when short), or its month and year when only the month is known. */
function shortWhen(line: PreviewLine, short: boolean, f: Formatters): string {
  const day = Temporal.PlainDate.from(line.day);
  if (line.monthOnly) return f.monthTitle(day.toPlainYearMonth());
  return short ? f.dayMonth(day) : f.date(day);
}

function RaceList({ lines, total }: { lines: PreviewLine[]; total: number }) {
  const { t, f } = useI18n();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <BlockTitle id={headingId}>{t.auth.yourRaces(total)}</BlockTitle>
      <ul className="flex flex-col gap-2 text-sm">
        {lines.map((line) => (
          // Not a link: the page of a race needs an account.
          <li key={`${line.event}|${line.day}`} className="grid grid-cols-[7rem_1fr] gap-x-3">
            <span className="text-neutral-600">{shortWhen(line, false, f)}</span>
            <span className="flex flex-col">
              <span className="font-medium">{line.event}</span>
              {line.people.length > 0 && (
                <span className="text-xs text-neutral-600">
                  {t.auth.with(line.people.join(", "))}
                  {line.morePeople > 0 && ` ${t.auth.morePeople(line.morePeople)}`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {total > lines.length && (
        <p className="text-sm text-neutral-600">{t.auth.more(total - lines.length)}</p>
      )}
    </section>
  );
}
