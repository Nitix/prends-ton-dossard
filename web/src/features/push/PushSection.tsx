import { useQueryClient } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { PRIMARY, SECONDARY, DANGER_TEXT } from "../../components/buttons";
import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useUserId } from "../auth/session";
import { describeError } from "../profile/forms";
import { day } from "../profile/PasskeyList";
import { useReminders } from "../reminders/api";
import { deleteDevice, pushKey, sendTest, usePush, type PushDevice } from "./api";
import { deviceLabel } from "./deviceLabel";
import { disableOnThisDevice, enableOnThisDevice, thisDeviceEndpoint } from "./subscribe";
import { pushSupport } from "./support";
import { rememberedDevice } from "./thisDevice";

/** What the section says after an action: a result (polite) or a refusal (an alert). */
type Message = { ok: boolean; text: string };

/**
 * "Notifications on this device", in the "Rappels" section of the settings page:
 * turn the notifications on or off for this device, send a test, and the list of
 * the member's devices, each of which can be removed. What the page says depends
 * on what the browser can do (see support.ts): an iPhone outside the installed
 * app is told how to install, a refused permission how to allow it, a browser
 * with no Push API that it cannot. The section is absent when the server has no
 * notifications (the demo).
 *
 * The button that turns them on asks the permission as the first thing its
 * handler does, before any `await` (see enableOnThisDevice). The buttons are busy
 * through `aria-disabled` and a ref that is set on the spot, never `disabled`.
 * The button that goes with its action (it turns into the other, or the row
 * goes) hands the focus to the title of the section, `headingRef`, as it goes.
 */
export function PushSection({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { t, lang, formatLocale } = useI18n();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const push = usePush();
  const reminders = useReminders();
  const [support, setSupport] = useState(() => pushSupport());
  // The address of this device's subscription: undefined until the browser has said.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    if (support !== "ready") return undefined;
    let current = true;
    void (async () => {
      const address = await thisDeviceEndpoint().catch(() => null);
      if (current) setEndpoint(address);
    })();
    return () => {
      current = false;
    };
  }, [support]);

  // The ref of a button that goes with its action. Its cleanup runs as the button
  // leaves the page, while it is still there: if it has the focus, the title takes
  // it. It must be the same function from one render to the next.
  const giveFocusBack = useCallback(
    (button: HTMLButtonElement) => () => {
      if (document.activeElement === button) headingRef.current?.focus();
    },
    [headingRef],
  );

  // The demo has no notifications: nothing to show, and nothing to say about them.
  if (push.data === null) return null;

  const info = push.data;
  const publicKey = info?.publicKey;

  /** Runs an action one at a time; what it throws is said in an alert. */
  async function run(action: () => Promise<Message | null>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      setMessage({ ok: false, text: describeFailure(err) });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function describeFailure(err: unknown): string {
    // The test route answers a bare 429, with no code, when it was used a moment ago.
    if (err instanceof ClientResponseError && err.status === 429) return t.push.tooManyTests;
    return describeError(t, err);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: pushKey(userId) });
    setEndpoint(await thisDeviceEndpoint().catch(() => null));
  }

  function enable() {
    if (working.current) return;
    if (publicKey === undefined) return;
    // The first thing that runs in the tap: the permission is asked now, before
    // anything is awaited, or iOS does not show the prompt.
    const asked = enableOnThisDevice(
      publicKey,
      lang,
      deviceLabel(navigator.userAgent, navigator.maxTouchPoints, t),
    );
    void run(async () => {
      try {
        if ((await asked) === "enabled") {
          await refresh();
          return { ok: true, text: t.push.enabled };
        }
        // Refused for good, or the prompt was closed: the page says which.
        setSupport(pushSupport());
        return null;
      } catch (err) {
        setSupport(pushSupport());
        throw err;
      }
    });
  }

  function disable() {
    void run(async () => {
      try {
        await disableOnThisDevice();
      } finally {
        await refresh();
      }
      return { ok: true, text: t.push.disabled };
    });
  }

  function test() {
    void run(async () => {
      const { sent, failed } = await sendTest();
      const parts = [sent === 0 ? t.push.testNone : t.push.testSent(sent)];
      if (failed > 0 && sent > 0) parts.push(t.push.testFailed(failed));
      return { ok: true, text: parts.join(" ") };
    });
  }

  function remove(device: PushDevice) {
    void run(async () => {
      if (device.id === rememberedDevice()) {
        // This one: the browser lets go of its subscription too.
        try {
          await disableOnThisDevice();
        } finally {
          await refresh();
        }
      } else {
        await deleteDevice(device.id);
        await refresh();
      }
      return null;
    });
  }

  const unreadable = push.isError && info === undefined;
  const none = reminders.data?.length === 0;
  const enabled = endpoint !== undefined && endpoint !== null;

  let body;
  if (support === "needs-install") body = <p>{t.push.needsInstall}</p>;
  else if (support === "unsupported") body = <p>{t.push.unsupported}</p>;
  else if (support === "denied") body = <p>{t.push.denied}</p>;
  else if (info !== undefined && !info.available) body = <p>{t.push.unavailable}</p>;
  else if (info !== undefined) {
    body = (
      <>
        {none && <p className="text-sm text-neutral-600">{t.push.chooseFirst}</p>}
        {enabled ? (
          <div className="flex flex-wrap gap-2">
            <button
              ref={giveFocusBack}
              type="button"
              onClick={disable}
              aria-disabled={busy}
              className={SECONDARY}
            >
              {t.push.disable}
            </button>
            <button type="button" onClick={test} aria-disabled={busy} className={SECONDARY}>
              {t.push.test}
            </button>
          </div>
        ) : (
          <button
            ref={giveFocusBack}
            type="button"
            onClick={enable}
            aria-disabled={busy}
            className={`${PRIMARY} self-start`}
          >
            {t.push.enable}
          </button>
        )}
      </>
    );
  }

  const here = rememberedDevice();

  return (
    <>
      <h3 className="eyebrow">{t.push.title}</h3>
      {unreadable && <LoadFailure heading={headingRef} onRetry={() => push.refetch()} />}
      {body}
      {/* The status line stays in the page, empty, so that a screen reader hears what it comes to say. */}
      <output className="text-sm font-medium text-neutral-700">
        {message?.ok === true ? message.text : ""}
      </output>
      {message?.ok === false && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message.text}
        </p>
      )}
      {info !== undefined && (
        <>
          <h4 className="eyebrow">{t.push.devicesTitle}</h4>
          {info.devices.length === 0 ? (
            <p className="text-sm">{t.push.noDevices}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {info.devices.map((device) => (
                <li
                  key={device.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-neutral-50 p-3.5 ring-1 ring-neutral-100"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {device.label}
                      {device.id === here && (
                        <span className="ml-2 text-sm font-normal text-neutral-600">
                          ({t.push.thisDevice})
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-neutral-600">
                      {t.push.since(day(formatLocale, device.created))}
                      {" · "}
                      {device.lastSuccessAt === ""
                        ? t.push.neverReminded
                        : t.push.lastReminder(day(formatLocale, device.lastSuccessAt))}
                    </p>
                  </div>
                  <button
                    ref={giveFocusBack}
                    type="button"
                    onClick={() => {
                      remove(device);
                    }}
                    aria-disabled={busy}
                    aria-label={t.push.removeLabel(device.label)}
                    className={`${SECONDARY} ${DANGER_TEXT}`}
                  >
                    {t.push.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
