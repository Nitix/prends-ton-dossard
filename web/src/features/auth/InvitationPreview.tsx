import { useId } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import { dayOrMonth } from "../events/eventWhen";
import type { Invitation, PreviewLine } from "./InvitationPage";

const SEPARATOR = " · ";

/**
 * What waits behind an invitation link: the races of the person invited (with
 * the friends going), then the next races of the group. Each block is absent
 * when it has nothing to show; with no race of their own, the group's block says
 * it is the group's next races rather than « also ».
 */
export function InvitationPreview({
  invitation,
  today,
}: {
  invitation: Invitation;
  today: Temporal.PlainDate;
}) {
  const { t } = useI18n();
  const mine = invitation.upcoming?.races ?? [];
  const total = invitation.upcoming?.total ?? 0;
  const group = invitation.group ?? [];

  return (
    <>
      {mine.length > 0 && (
        <PreviewSection title={t.auth.yourRaces(total)} lines={mine} today={today}>
          {total > mine.length && (
            <p className="text-sm text-neutral-600">{t.auth.more(total - mine.length)}</p>
          )}
        </PreviewSection>
      )}
      {group.length > 0 && (
        <PreviewSection
          title={mine.length > 0 ? t.auth.groupToo : t.auth.groupNext}
          lines={group}
          today={today}
        />
      )}
    </>
  );
}

function PreviewSection({
  title,
  lines,
  today,
  children,
}: {
  title: string;
  lines: PreviewLine[];
  today: Temporal.PlainDate;
  children?: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <BlockTitle id={headingId}>{title}</BlockTitle>
      <ul className="race-list flex flex-col gap-2">
        {lines.map((line) => (
          <PreviewRow key={`${line.event}|${line.day}`} line={line} today={today} />
        ))}
      </ul>
      {children}
    </section>
  );
}

/** A race, in the style of a row of « Mes prochaines courses ». It is not a link: the page of a race needs an account. */
function PreviewRow({ line, today }: { line: PreviewLine; today: Temporal.PlainDate }) {
  const { t, f } = useI18n();
  const day = Temporal.PlainDate.from(line.day);
  const daysLeft = daysBetween(today, day);
  // A race that has begun (several days) has no countdown, nor has a race known by its month.
  const countdown = !line.monthOnly && daysLeft >= 0 ? f.inDays(daysLeft) : null;
  const when = dayOrMonth(
    { start_date: line.day, date_precision: line.monthOnly ? "month" : "day" },
    day,
    f,
    t,
  );
  const formats = line.formats ?? [];

  return (
    <li className="upcoming-row card flex flex-col p-3.5 pr-4">
      <p className="text-sm text-neutral-600">
        {countdown === null ? when : `${when}${SEPARATOR}${countdown}`}
      </p>
      <h3 className="card-title">{line.event}</h3>
      <p className="text-sm text-neutral-800">
        {formats.length > 0 ? `${line.location}${SEPARATOR}${formats.join(", ")}` : line.location}
      </p>
      {line.people.length > 0 && (
        <p className="text-sm text-neutral-600">
          {t.auth.with(line.people.join(", "))}
          {line.morePeople > 0 && ` ${t.auth.morePeople(line.morePeople)}`}
        </p>
      )}
    </li>
  );
}
