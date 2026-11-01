import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Avatar } from "../../components/Avatar";
import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { SECTION } from "../../components/section";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import { parseDate } from "../../lib/dates";
import type { Formatters } from "../../lib/format";
import type { OfferKind, OfferRecord } from "../../lib/types";
import { webAddress } from "../../lib/url";
import type { EventView } from "../events/api";
import { canManageOffer, canRemoveMember, type Me } from "../participations/permissions";
import { describeError } from "../profile/forms";
import { AddToOfferDialog } from "./AddToOfferDialog";
import { useDeleteOffer, useLeavePlace, useOffers, useTakePlace, type OfferView } from "./api";
import { OfferDialog } from "./OfferDialog";
import { canTakePlace, hasPlaceOfKind, isFull } from "./offerRules";

const SEPARATOR = " · ";

/**
 * The offers of one kind for an event: the cars (`ride`, « Covoiturage ») or
 * the lodgings (`lodging`, « Logement »), each with who offers it, where and
 * when, how many places are taken and by whom. A member takes a place for
 * themselves, or frees theirs; the owner of an offer, or an admin, also puts
 * someone in (`AddToOfferDialog`), takes someone out, changes the offer
 * (`OfferDialog`) or deletes it (after a confirmation that names the people who
 * lose their place). Under the offers, a member who has no place of this kind
 * in the event may propose their own car or lodging. `me` is null while the
 * runner of the user loads: the offers can be read, not acted on.
 *
 * The page asks for the offers of both kinds in one request, which the two
 * sections share: what a runner may take depends on the places they already
 * have in the other offers of the kind.
 *
 * The focus stays where the member is: after a place is taken or freed it is
 * on the button that takes the other's place, or on the title of the offer; and
 * a deleted offer takes the focus away with its button, and so does an offer
 * that has just been proposed (the member has their place now, and there is no
 * more to propose), so it goes to the title of the section, which is not in the
 * tab order (it only receives the focus from here). The windows of the other
 * actions give it back to their button, which stays.
 */
export function OffersSection({
  view,
  kind,
  me,
}: {
  view: EventView;
  kind: OfferKind;
  me: Me | null;
}) {
  const { t, f } = useI18n();
  const eventId = view.event.id;
  const query = useOffers(eventId);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The offer the open confirmation is about, and the one that has just been deleted.
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  // Whether the window that offers a car or a lodging is open, and how many offers it has saved.
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState(0);
  const proposedHandled = useRef(0);

  // A refresh that fails keeps what the section already shows. While the
  // offers load, or when they could not, the section is there all the same,
  // with its title.
  const all = query.data;
  const offers = all?.filter(({ offer }) => offer.kind === kind);
  // A member has one place of each kind in an event (a car or a bed of their own, or a seat in one):
  // «Proposer» is for those who have none, and it needs the list to know.
  const canPropose = !!me && !!all && !hasPlaceOfKind(all, kind, me.runnerId);
  // The confirmation follows the list: the people it names are those who are in the offer now.
  const target = removing === null ? undefined : all?.find(({ offer }) => offer.id === removing);
  const names = target?.members.map(({ runner }) => runner.name) ?? [];

  // Once the dialog is closed and the page shows the offer gone, the button
  // that opened the dialog is gone too: if nothing has the focus, the title
  // does. Either may come first (the dialog closes when the request is
  // over, and the page shows the new list a moment later, or the reverse):
  // a dialog that is still open keeps the focus where it is, and an offer that
  // is still on the page keeps its button.
  useEffect(() => {
    if (deleted === null || handled.current === deleted || removing !== null) return;
    if (all?.some(({ offer }) => offer.id === deleted)) return;
    handled.current = deleted;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) heading.current?.focus();
  }, [deleted, removing, all]);

  // The offer that has just been proposed takes the button that opened the
  // window off the page (its owner has their place now), whether the window
  // closes first or the list shows it first: once the window is closed and the
  // button is gone, if nothing has the focus, the title of the section does.
  useEffect(() => {
    if (proposed === proposedHandled.current || proposing || canPropose) return;
    proposedHandled.current = proposed;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) heading.current?.focus();
  }, [proposed, proposing, canPropose]);

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-3 ${SECTION}`}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {t.offers.title[kind]}
      </h2>
      {offers && all ? (
        <>
          {offers.length === 0 ? (
            <p className="text-sm text-neutral-600">{t.offers.empty[kind]}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {offers.map((offerView) => (
                <OfferItem
                  key={offerView.offer.id}
                  view={offerView}
                  offers={all}
                  event={view}
                  me={me}
                  onDelete={() => {
                    setRemoving(offerView.offer.id);
                  }}
                />
              ))}
            </div>
          )}
          {canPropose && (
            <button
              type="button"
              onClick={() => {
                setProposing(true);
              }}
              className={`${SECONDARY} self-start`}
            >
              {t.offers.propose[kind]}
            </button>
          )}
        </>
      ) : query.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : (
        <output>{t.common.loading}</output>
      )}
      <OfferDialog
        open={proposing}
        onClose={() => {
          setProposing(false);
        }}
        onSaved={() => {
          setProposed((count) => count + 1);
        }}
        view={view}
        kind={kind}
      />
      <Dialog
        open={target !== undefined}
        onClose={() => {
          setRemoving(null);
        }}
        title={
          names.length === 0
            ? t.offers.deleteConfirmEmpty
            : t.offers.deleteConfirm(f.list(names), names.length)
        }
      >
        {target && (
          <DeleteForm
            eventId={eventId}
            offerId={target.offer.id}
            onDeleted={() => {
              setDeleted(target.offer.id);
            }}
            onClose={() => {
              setRemoving(null);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

/** Where the focus goes once a place is taken or freed: the button of the offer that does the opposite, or its title. */
type FocusTo = "toggle" | "title";

/** A change of the places of an offer that the page has not shown yet: the places before, and where the focus goes. */
type Settling = { from: string; to: FocusTo };

/** The line under the owner: where, and when. A car leaves from a place on a day at a time, a lodging has its days. */
function detailLine(offer: OfferRecord, f: Formatters, t: Messages): string {
  const day = offer.date ? f.date(parseDate(offer.date)) : undefined;
  const parts: (string | undefined)[] = [];
  if (offer.kind === "ride") {
    parts.push(t.offers.rideFrom(offer.place), day, offer.time);
  } else {
    // A departure the same day as the arrival is the arrival, said once.
    const end =
      offer.end_date && offer.end_date !== offer.date
        ? f.date(parseDate(offer.end_date))
        : undefined;
    parts.push(offer.place, day && end ? t.offers.dates(day, end) : day);
  }
  return parts.filter((part) => !!part).join(SEPARATOR);
}

/**
 * An offer: who offers it, where and when, the places in words (never by a
 * colour alone), the people who have one, the notes, and the actions of the
 * member on it. The owner is the title of the offer: a section holds one offer
 * after another, and the title is where the focus lands when a button goes.
 */
function OfferItem({
  view,
  offers,
  event,
  me,
  onDelete,
}: {
  view: OfferView;
  /** The offers of the event, of both kinds: whether a place can be taken depends on the places the member has already. */
  offers: OfferView[];
  event: EventView;
  me: Me | null;
  onDelete: () => void;
}) {
  const { t, f } = useI18n();
  const { offer, owner, members } = view;
  const kind = offer.kind;
  const eventId = event.event.id;
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // « Je monte » or « Je descends »: only one is on the page at a time.
  const toggle = useRef<HTMLButtonElement>(null);
  const take = useTakePlace(eventId);
  const leave = useLeavePlace(eventId);
  const [message, setMessage] = useState<string | null>(null);
  // The windows of the owner and the admin: they give the focus back to their button when they close.
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  // Set on the spot: the state of a mutation is there after a render only, and two taps can come before it.
  const acting = useRef(false);
  const busy = take.isPending || leave.isPending;

  // A place that is taken or freed takes the focus away with its button, and
  // the page only has the new places a moment after the request is over: the
  // focus waits for them. It only moves when it has been lost (the user may
  // have gone on to something else).
  const places = members.map(({ member }) => member.id).join();
  const [settling, setSettling] = useState<Settling | null>(null);
  const handled = useRef<Settling | null>(null);
  useEffect(() => {
    if (!settling || handled.current === settling || settling.from === places) return;
    handled.current = settling;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const target = settling.to === "toggle" ? (toggle.current ?? title.current) : title.current;
    target?.focus();
  }, [settling, places]);

  async function run(action: () => Promise<unknown>, to: FocusTo) {
    if (acting.current) return;
    acting.current = true;
    setMessage(null);
    const from = places;
    try {
      await action();
      setSettling({ from, to });
    } catch (err) {
      setMessage(describeError(t, err));
    } finally {
      acting.current = false;
    }
  }

  const seats = offer.seats ?? 0;
  const ad = kind === "lodging" ? webAddress(offer.url) : null;
  const canTake = !!me && canTakePlace(offers, view, me.runnerId);
  const mine = !!me && members.some(({ runner }) => runner.id === me.runnerId);
  const manage = !!me && canManageOffer(owner, me);

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border-2 border-neutral-200 p-3"
    >
      <div className="flex items-center gap-3">
        <Avatar
          runner={owner}
          thumb="96x96"
          className="size-11 shrink-0 bg-neutral-200 text-sm font-semibold text-neutral-700"
        />
        <h3 id={titleId} ref={title} tabIndex={-1} className="min-w-0 font-medium break-words">
          {owner.name}
        </h3>
      </div>
      <div className="flex flex-wrap items-center gap-x-3">
        <p className="break-words">{detailLine(offer, f, t)}</p>
        {ad && (
          <a
            href={ad}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center underline"
          >
            {t.offers.seeAd}
          </a>
        )}
      </div>
      <p className="text-sm text-neutral-600">
        {seats > 0 ? t.offers.taken(members.length, seats) : t.offers.unlimited(members.length)}
        {isFull(view) && (
          <>
            {SEPARATOR}
            <span className="font-medium text-neutral-900">{t.offers.full}</span>
          </>
        )}
      </p>
      {members.length > 0 && (
        <ul className="flex flex-col gap-1">
          {members.map(({ member, runner }) => (
            <li key={member.id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar
                  runner={runner}
                  thumb="96x96"
                  className="size-9 shrink-0 bg-neutral-200 text-xs font-semibold text-neutral-700"
                />
                <p className="font-medium break-words">{runner.name}</p>
              </div>
              {me && canRemoveMember(runner, owner, me) && (
                <button
                  type="button"
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    void run(
                      () => leave.mutateAsync(member.id),
                      runner.id === me.runnerId ? "toggle" : "title",
                    );
                  }}
                  className={`${SECONDARY} ${busy ? "opacity-60" : ""}`}
                >
                  {t.offers.removeFor(runner.name)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {offer.notes && <p className="break-words whitespace-pre-wrap">{offer.notes}</p>}
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      {me && (canTake || mine || manage) && (
        <div className="flex flex-wrap gap-2">
          {canTake && (
            <button
              ref={toggle}
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                void run(
                  () => take.mutateAsync({ offer: offer.id, runner: me.runnerId }),
                  "toggle",
                );
              }}
              className={`${PRIMARY} ${busy ? "opacity-60" : ""}`}
            >
              {t.offers.take[kind]}
            </button>
          )}
          {mine && (
            <button
              ref={toggle}
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                const place = members.find(({ runner }) => runner.id === me.runnerId);
                if (place) void run(() => leave.mutateAsync(place.member.id), "toggle");
              }}
              className={`${SECONDARY} ${busy ? "opacity-60" : ""}`}
            >
              {t.offers.leave[kind]}
            </button>
          )}
          {manage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                }}
                className={SECONDARY}
              >
                {t.offers.addSomeone}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                }}
                className={SECONDARY}
              >
                {t.offers.edit}
              </button>
              <button type="button" onClick={onDelete} className={`${SECONDARY} ${DANGER_TEXT}`}>
                {t.offers.delete}
              </button>
            </>
          )}
        </div>
      )}
      {manage && (
        <>
          <AddToOfferDialog
            open={adding}
            onClose={() => {
              setAdding(false);
            }}
            eventId={eventId}
            offers={offers}
            offer={view}
          />
          <OfferDialog
            open={editing}
            onClose={() => {
              setEditing(false);
            }}
            view={event}
            kind={kind}
            offer={view}
          />
        </>
      )}
    </article>
  );
}

/** The confirmation of the deletion of an offer: it is deleted when the member says so, and the window closes. */
function DeleteForm({
  eventId,
  offerId,
  onDeleted,
  onClose,
}: {
  eventId: string;
  offerId: string;
  /** Tells the section that the offer is gone, before the window closes. */
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteOffer(eventId);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await remove.mutateAsync(offerId);
    } catch (err) {
      setMessage(describeError(t, err));
      return;
    }
    onDeleted();
    onClose();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={remove.isPending} className={DANGER}>
          {t.offers.delete}
        </button>
      </div>
    </form>
  );
}
