import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Avatar } from "../../components/Avatar";
import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { SECTION } from "../../components/section";
import { SectionMarker } from "../../components/Slots";
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
 * The focus stays where the member is. What the member does on an offer (a
 * place taken, freed or removed, a deletion asked for) can take the button they
 * used off the page, whether the server did it or refused: the answer to a
 * request shows the offer as it is now (full, or with a place already
 * somewhere else, or gone). The section looks after the focus until the page
 * shows that answer (see `Guard`): if the button went with nothing to take
 * the focus, it goes to the button that does the opposite, or to the title of
 * the offer, or, when the offer itself is gone, to the title of the section.
 * The title of the section is not in the tab order (it only receives the
 * focus from here), and neither is the title of an offer. An offer that has
 * just been proposed takes the button that opened its window away too (the
 * member has their place now, and there is no more to propose): the title of
 * the section has the focus then as well.
 *
 * The windows that change an offer or put someone in it are the section's, not
 * the offer's, and are looked after the same way while they are open: they
 * give the focus back to their button, which stays, unless the offer has gone
 * in the meantime (somebody deleted it: the window goes with it, and the title
 * of the section has the focus) or the button has (the last place was taken:
 * the title of the offer has it).
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
  const root = useRef<HTMLElement>(null);
  // The offer the open confirmation is about, and what the member is doing that can take the focus away.
  const [removing, setRemoving] = useState<string | null>(null);
  // The offer whose window is open, and which: the one that changes it, or the one that puts someone in it.
  const [managing, setManaging] = useState<{ offer: string; action: "edit" | "add" } | null>(null);
  const [guard, setGuard] = useState<Guard | null>(null);
  // The guard that is history: it is not looked after any more.
  const finished = useRef<Guard | null>(null);
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
  // The same for the windows of the owner: they close with the offer they are about.
  const managed =
    managing === null ? undefined : all?.find(({ offer }) => offer.id === managing.offer);

  /**
   * Marks the request of the member on this offer as over: the list has been
   * asked for again (the mutations wait for it), so the next draw has the answer.
   */
  function over(offer: string) {
    setGuard((current) =>
      current?.offer === offer && !current.over ? { ...current, over: true } : current,
    );
  }

  /** Runs a request of the member on an offer, and looks after the focus until the page shows the answer. */
  async function guarded(offer: string, to: FocusTo, request: () => Promise<unknown>) {
    setGuard({ offer, to, over: false });
    try {
      await request();
    } finally {
      over(offer);
    }
  }

  /** Closes the confirmation without deleting anything: its button stays, and gets the focus back from the browser. */
  function cancel() {
    setRemoving(null);
    setGuard(null);
  }

  /** Opens the window that changes an offer, or puts someone in it, and looks after the offer until it is closed. */
  function manage(offer: string, action: "edit" | "add") {
    setManaging({ offer, action });
    setGuard({ offer, to: "title", over: false });
  }

  /**
   * Closes that window. What it did is history once it is saved (`over`: the
   * next draw has the answer, and moves the focus if the button that opened the
   * window went with it); a window that was only closed leaves nothing in
   * waiting, and its button, which stays, gets the focus back from the browser.
   */
  function closeManaging() {
    const offer = managing?.offer;
    setManaging(null);
    setGuard((current) => (current && current.offer === offer && !current.over ? null : current));
  }

  // The focus is only moved when it has been lost, never when the member has
  // gone on to something else (or the browser has already given it back to a
  // button that is still there). It is looked after on every draw until the
  // member's action is history: the answer can come before or after the
  // request is over, and the confirmation can close first or last. The action
  // is history once the offer is gone, or once the request is over (the draw
  // that shows it over has the answer of the server: a list that is asked for
  // again is in the cache when the request ends, and a draw reads the cache).
  // A later change of the list is nobody's doing, and does not move the focus.
  useEffect(() => {
    if (!guard || finished.current === guard) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      const item = Array.from(
        root.current?.querySelectorAll<HTMLElement>("[data-offer]") ?? [],
      ).find((element) => element.dataset.offer === guard.offer);
      const places: FocusTo[] = guard.to === "toggle" ? ["toggle", "title"] : [guard.to];
      const landing = places
        .map((place) => item?.querySelector<HTMLElement>(`[data-offer-focus="${place}"]`))
        .find((element) => !!element);
      (landing ?? heading.current)?.focus();
    }
    if (guard.over || !all?.some(({ offer }) => offer.id === guard.offer)) finished.current = guard;
  }, [guard, all]);

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
    <section ref={root} aria-labelledby={headingId} className={`flex flex-col gap-3 ${SECTION}`}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="block-title section-title">
        <SectionMarker />
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
                  guarded={guarded}
                  onManage={(action) => {
                    manage(offerView.offer.id, action);
                  }}
                  onDelete={() => {
                    // The offer goes with the confirmation, and with the button that opened it.
                    setRemoving(offerView.offer.id);
                    setGuard({ offer: offerView.offer.id, to: "section", over: false });
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
      <OfferDialog
        open={managing?.action === "edit" && managed !== undefined}
        onClose={closeManaging}
        onSaved={() => {
          if (managing) over(managing.offer);
        }}
        view={view}
        kind={kind}
        offer={managed}
      />
      <AddToOfferDialog
        open={managing?.action === "add" && managed !== undefined}
        onClose={closeManaging}
        onAdded={() => {
          if (managing) over(managing.offer);
        }}
        eventId={eventId}
        offers={all ?? []}
        offer={managed}
      />
      <Dialog
        open={target !== undefined}
        onClose={cancel}
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
              over(target.offer.id);
              setRemoving(null);
            }}
            onCancel={cancel}
          />
        )}
      </Dialog>
    </section>
  );
}

/**
 * Where the focus goes when the button the member used is gone: the button of
 * the offer that does the opposite (« Je descends » after « Je monte »), then
 * the title of the offer; or the title of the section. The title of the
 * section is also where the focus ends when the offer itself is gone.
 */
type FocusTo = "toggle" | "title" | "section";

/**
 * What the member is doing on an offer that can take the focus away: the offer,
 * where the focus goes, and whether the request is over (a confirmation is
 * not over until the member has answered it).
 */
type Guard = { offer: string; to: FocusTo; over: boolean };

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
  guarded,
  onManage,
  onDelete,
}: {
  view: OfferView;
  /** The offers of the event, of both kinds: whether a place can be taken depends on the places the member has already. */
  offers: OfferView[];
  event: EventView;
  me: Me | null;
  /** Runs a request on this offer, and has the section look after the focus until the page shows the answer. */
  guarded: (offer: string, to: FocusTo, request: () => Promise<unknown>) => Promise<void>;
  /** Opens the window of the section that changes the offer, or puts someone in it. */
  onManage: (action: "edit" | "add") => void;
  onDelete: () => void;
}) {
  const { t, f } = useI18n();
  const { offer, owner, members } = view;
  const kind = offer.kind;
  const eventId = event.event.id;
  const titleId = useId();
  const take = useTakePlace(eventId);
  const leave = useLeavePlace(eventId);
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of a mutation is there after a render only, and two taps can come before it.
  const acting = useRef(false);
  const busy = take.isPending || leave.isPending;

  async function run(action: () => Promise<unknown>, to: FocusTo) {
    if (acting.current) return;
    acting.current = true;
    setMessage(null);
    try {
      await guarded(offer.id, to, action);
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
      data-offer={offer.id}
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3.5 ring-1 ring-neutral-100"
    >
      <div className="flex items-center gap-3">
        <Avatar
          runner={owner}
          thumb="96x96"
          className="avatar-soft size-11 shrink-0 text-sm font-bold"
        />
        <h3
          id={titleId}
          data-offer-focus="title"
          tabIndex={-1}
          className="min-w-0 font-medium break-words"
        >
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
            className="inline-flex min-h-11 items-center font-medium text-iris-700 underline underline-offset-4"
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
                  className="avatar-soft size-9 shrink-0 text-xs font-bold"
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
      {/* The buttons that every offer has under the same name are described by the title of their offer. */}
      {me && (canTake || mine || manage) && (
        <div className="flex flex-wrap gap-2">
          {canTake && (
            <button
              data-offer-focus="toggle"
              type="button"
              aria-describedby={titleId}
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
              data-offer-focus="toggle"
              type="button"
              aria-describedby={titleId}
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
              {/* Nobody can be put in an offer that is full: the card says so. */}
              {!isFull(view) && (
                <button
                  type="button"
                  aria-describedby={titleId}
                  onClick={() => {
                    onManage("add");
                  }}
                  className={SECONDARY}
                >
                  {t.offers.addSomeone}
                </button>
              )}
              <button
                type="button"
                aria-describedby={titleId}
                onClick={() => {
                  onManage("edit");
                }}
                className={SECONDARY}
              >
                {t.offers.edit}
              </button>
              <button
                type="button"
                aria-describedby={titleId}
                onClick={onDelete}
                className={`${SECONDARY} ${DANGER_TEXT}`}
              >
                {t.offers.delete}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** The confirmation of the deletion of an offer: it is deleted when the member says so, and the window closes. */
function DeleteForm({
  eventId,
  offerId,
  onDeleted,
  onCancel,
}: {
  eventId: string;
  offerId: string;
  /** Tells the section that the offer is deleted: it closes the window. */
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteOffer(eventId);
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    try {
      await remove.mutateAsync(offerId);
    } catch (err) {
      setMessage(describeError(t, err));
      return;
    } finally {
      sending.current = false;
    }
    onDeleted();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={remove.isPending || undefined}
          className={`${DANGER} ${remove.isPending ? "opacity-60" : ""}`}
        >
          {t.offers.delete}
        </button>
      </div>
    </form>
  );
}
