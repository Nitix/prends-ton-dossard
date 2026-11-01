import { useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import { useRunners } from "../events/api";
import { SelectField } from "../participations/fields";
import { describeError } from "../profile/forms";
import { useTakePlace, type OfferView } from "./api";
import { canTakePlace } from "./offerRules";

/**
 * "Add someone" to an offer: the owner of the offer, or an admin, puts a runner
 * in it. The runners who are offered are those who can take a place in it
 * (`canTakePlace`: not the owner, nobody who has a place of this kind already,
 * and nobody once it is full). `offers` are those of the event, of both kinds,
 * which is what that depends on. The server has the last word.
 */
export function AddToOfferDialog({
  open,
  onClose,
  eventId,
  offers,
  offer,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  offers: OfferView[];
  offer: OfferView;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.offers.addSomeoneTitle}>
      <AddToOfferForm eventId={eventId} offers={offers} offer={offer} onClose={onClose} />
    </Dialog>
  );
}

function AddToOfferForm({
  eventId,
  offers,
  offer,
  onClose,
}: {
  eventId: string;
  offers: OfferView[];
  offer: OfferView;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const runners = useRunners();
  const take = useTakePlace(eventId);
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of a mutation is there after a render only, and two clicks can come before it.
  const acting = useRef(false);

  if (runners.isPending) return <output>{t.common.loading}</output>;
  if (runners.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.errors.generic}
        </p>
        <button
          type="button"
          onClick={() => void runners.refetch()}
          disabled={runners.isFetching}
          className={`${SECONDARY} self-start`}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  // Who can take a place now, by name.
  const available = runners.data
    .filter((runner) => canTakePlace(offers, offer, runner.id))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  // The page may load a change while the window is open: a runner who is not offered any more is not chosen any more.
  const runnerId = available.some((runner) => runner.id === chosen) ? chosen : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runnerId === "" || acting.current) return;
    acting.current = true;
    setMessage(null);
    try {
      await take.mutateAsync({ offer: offer.offer.id, runner: runnerId });
    } catch (err) {
      acting.current = false;
      setMessage(describeError(t, err));
      return;
    }
    onClose();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {available.length === 0 ? (
        <p className="text-sm">{t.offers.nobodyToAdd}</p>
      ) : (
        <SelectField label={t.participation.runner} value={runnerId} onChange={setChosen} required>
          <option value="" disabled>
            {t.participation.chooseRunner}
          </option>
          {available.map((runner) => (
            <option key={runner.id} value={runner.id}>
              {runner.name}
            </option>
          ))}
        </SelectField>
      )}
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={take.isPending || available.length === 0}
          className={PRIMARY}
        >
          {take.isPending ? t.auth.saving : t.participation.addSubmit}
        </button>
      </div>
    </form>
  );
}
