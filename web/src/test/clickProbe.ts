import { afterEach, beforeEach, type TaskMeta } from "vitest";
import { commands, page, server, type Locator } from "vitest/browser";

import type { NodeAnswer } from "./clickProbeNode";

// Setup file of the browser project (see vite.config.ts). A diagnostic of round 21, on the
// throwaway branch diag/safari-clicks only: on GitHub's Linux machines, a click of WebKit sometimes
// takes more than 5 s, and passes on the next try.
//
// On WebKit on CI only, every click of a locator is timed (userEvent.click goes through the same
// click). The time of each click is kept in the meta of its test; a click that takes more than
// 1.5 s, or throws, also leaves a record there. The JSON report keeps the meta, and
// tools/ci/vitest-annotate.mjs turns it into a notice. The record says whether the page drew frames
// (requestAnimationFrame), whether its main thread was free (setTimeout(0) round trips), whether
// it was visible and had the focus, when the events of the click reached it, where the frame of the
// tests and the element were, and how late the event loop of Node was (Playwright runs there).

/** What the page and Node said during a slow click. */
export type PageProbe = {
  /** How long the click took, in ms. */
  ms: number;
  /** The first line of the error, if it threw. */
  error?: string;
  /** The document of the test, at the end of the click. */
  doc: { visibility: DocumentVisibilityState; hidden: boolean; focus: boolean };
  /** The page round the frame of the test, at the end; null if it cannot be read. */
  top: { visibility: DocumentVisibilityState; focus: boolean } | null;
  /** The frames drawn: their number, the longest time without one, the first, and per 500 ms. */
  raf: { total: number; maxGap: number; first: number | null; per500: number[] };
  /** The setTimeout(0) round trips: their number, the longest time without one, per 500 ms. */
  timer: { total: number; maxGap: number; per500: number[] };
  /** When each kind of event first reached the page, in ms after the start of the click. */
  events: Record<string, number>;
  /** The frame of the test in its page: « x,y w×h dans W×H ». */
  frame: string | null;
  /** The element in the frame of the test, at the start of the click (it may be gone at the end
   * of a click that worked): « x,y w×h dans W×H, défilé x,y ». */
  targetStart: string | null;
  /** The same at the end of the click: where it was when Playwright gave up, for a timeout. */
  target: string | null;
  /** What Node said of the time of the click, and how long it took to answer. */
  node: (NodeAnswer & { rpcMs: number }) | { error: string };
};

/** A record as the meta of a test keeps it: with the attempt (0 for the first try). */
export type ClickProbe = PageProbe & { attempt: number };

declare module "vitest" {
  interface TaskMeta {
    /** The time of each click of the test, in ms, over all its attempts. */
    clickMs?: number[];
    /** A record of each click that took more than the threshold, or threw. */
    clickProbe?: ClickProbe[];
  }
}

declare module "vitest/browser" {
  interface BrowserCommands {
    clickProbeNode: (from: number, to: number) => Promise<NodeAnswer>;
  }
}

// The clocks and timers of the browser, kept before a test can put fake ones in their place.
const now = performance.now.bind(performance);
const epoch = Date.now.bind(Date);
const nextFrame = window.requestAnimationFrame.bind(window);
const later = window.setTimeout.bind(window);

/** Over this time, in ms, a click leaves a record (CLICK_PROBE_MS sets it, for a local check). */
const THRESHOLD = Number(import.meta.env.VITE_CLICK_PROBE_MS) || 1500;

// The events of a click, and the scroll Playwright does before it.
const EVENTS = ["scroll", "pointerdown", "mousedown", "pointerup", "mouseup", "click"];

/** How many of the times fall in each 500 ms from the start, up to the end. */
function per500(times: number[], start: number, end: number): number[] {
  const counts = Array.from({ length: Math.max(1, Math.ceil((end - start) / 500)) }, () => 0);
  for (const time of times) {
    const index = Math.min(counts.length - 1, Math.max(0, Math.floor((time - start) / 500)));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

/** The longest time without a callback, from the start to the end. */
function maxGap(times: number[], start: number, end: number): number {
  let last = start;
  let gap = 0;
  for (const time of times) {
    gap = Math.max(gap, time - last);
    last = time;
  }
  return Math.round(Math.max(gap, end - last));
}

const round = Math.round;

/** Starts counting frames, timer round trips and events; `stop` ends it and gives them. */
function watch() {
  const start = now();
  const startEpoch = epoch();
  const frames: number[] = [];
  const ticks: number[] = [];
  const events: Record<string, number> = {};
  let running = true;
  const onFrame = () => {
    if (!running) return;
    frames.push(now());
    nextFrame(onFrame);
  };
  const onTick = () => {
    if (!running) return;
    ticks.push(now());
    later(onTick, 0);
  };
  const onEvent = (event: Event) => {
    events[event.type] ??= round(now() - start);
  };
  nextFrame(onFrame);
  later(onTick, 0);
  for (const type of EVENTS)
    window.addEventListener(type, onEvent, { capture: true, passive: true });
  return {
    stop() {
      running = false;
      for (const type of EVENTS) window.removeEventListener(type, onEvent, { capture: true });
      return { start, end: now(), startEpoch, endEpoch: epoch(), frames, ticks, events };
    },
  };
}

type Seen = ReturnType<ReturnType<typeof watch>["stop"]>;

/** The frame of the test in its page, or null if it cannot be read. */
function frameBox(): string | null {
  try {
    const element = window.frameElement;
    const parent = element?.ownerDocument.defaultView;
    if (!element || !parent) return null;
    const box = element.getBoundingClientRect();
    const transform = parent.getComputedStyle(element).transform;
    return (
      `${round(box.x)},${round(box.y)} ${round(box.width)}×${round(box.height)} dans ${parent.innerWidth}×${parent.innerHeight}` +
      (transform === "none" ? "" : ` ${transform}`)
    );
  } catch {
    return null;
  }
}

/** The element of the click in the frame of the test. */
function targetBox(locator: Locator): string | null {
  try {
    const element = locator.query();
    if (!element) return "absente";
    const box = element.getBoundingClientRect();
    return `${round(box.x)},${round(box.y)} ${round(box.width)}×${round(box.height)} dans ${innerWidth}×${innerHeight}, défilé ${round(scrollX)},${round(scrollY)}`;
  } catch (error) {
    return `? ${firstLine(error).slice(0, 80)}`;
  }
}

/** The page round the frame of the test, or null if it cannot be read. */
function topState(): PageProbe["top"] {
  try {
    const outer = window.top;
    if (!outer || outer === window) return null;
    return { visibility: outer.document.visibilityState, focus: outer.document.hasFocus() };
  } catch {
    return null;
  }
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (text.split("\n")[0] ?? "").slice(0, 200);
}

/** What Node says of the time of the click; it never waits more than 3 s for the answer. */
async function askNode(from: number, to: number): Promise<PageProbe["node"]> {
  const asked = now();
  try {
    const answer = await Promise.race([
      commands.clickProbeNode(from, to),
      new Promise<never>((_, reject) => {
        later(() => reject(new Error("pas de réponse en 3 s")), 3000);
      }),
    ]);
    return { ...answer, rpcMs: round(now() - asked) };
  } catch (error) {
    return { error: firstLine(error).slice(0, 120) };
  }
}

async function describe(
  locator: Locator,
  seen: Seen,
  targetStart: string | null,
  failure?: { cause: unknown },
) {
  const { start, end, frames, ticks } = seen;
  const probe: PageProbe = {
    ms: round(end - start),
    doc: {
      visibility: document.visibilityState,
      hidden: document.hidden,
      focus: document.hasFocus(),
    },
    top: topState(),
    raf: {
      total: frames.length,
      maxGap: maxGap(frames, start, end),
      first: frames[0] === undefined ? null : round(frames[0] - start),
      per500: per500(frames, start, end),
    },
    timer: {
      total: ticks.length,
      maxGap: maxGap(ticks, start, end),
      per500: per500(ticks, start, end),
    },
    events: seen.events,
    frame: frameBox(),
    targetStart,
    target: targetBox(locator),
    node: await askNode(seen.startEpoch, seen.endEpoch),
  };
  if (failure) probe.error = firstLine(failure.cause);
  return probe;
}

/**
 * A click that is timed: `report` gets its time, and a record when it took more than `threshold`
 * ms or threw. An error of the click is thrown again, as it was.
 */
export function probed<A extends unknown[]>(
  click: (this: Locator, ...args: A) => PromiseLike<void>,
  report: (ms: number, probe: PageProbe | undefined) => void,
  threshold = THRESHOLD,
): (this: Locator, ...args: A) => Promise<void> {
  return async function probedClick(this: Locator, ...args: A): Promise<void> {
    const targetStart = targetBox(this);
    const watching = watch();
    const settle = async (failure?: { cause: unknown }) => {
      const seen = watching.stop();
      const ms = seen.end - seen.start;
      report(
        ms,
        failure || ms > threshold ? await describe(this, seen, targetStart, failure) : undefined,
      );
    };
    try {
      await click.apply(this, args);
    } catch (error) {
      await settle({ cause: error });
      throw error;
    }
    await settle();
  };
}

type Task = { meta: TaskMeta; result?: { retryCount?: number } };

/** Keeps the time of a click, and its record, in the meta of the test (none outside a test). */
export function record(task: Task | undefined, ms: number, probe: PageProbe | undefined): void {
  if (!task) return;
  (task.meta.clickMs ??= []).push(round(ms));
  if (probe)
    (task.meta.clickProbe ??= []).push({ attempt: task.result?.retryCount ?? 0, ...probe });
}

/** On WebKit on CI only: elsewhere the clicks are left as they are. */
export const probing = server.browser === "webkit" && Boolean(import.meta.env.VITE_CI);

let current: Task | undefined;

if (probing) {
  beforeEach((context) => {
    current = context.task;
  });
  afterEach(() => {
    current = undefined;
  });
  type Click = (this: Locator, options?: unknown) => Promise<void>;
  // The setup file may be loaded twice in a frame (see touchDialogClicks.ts): the click is wrapped
  // once.
  const installed = Symbol.for("ptd.clickProbe");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the class of the locators is not exported
  const prototype = Object.getPrototypeOf(page.getByRole("button")) as {
    click: Click;
    [installed]?: true;
  };
  if (!prototype[installed]) {
    prototype.click = probed(prototype.click, (ms, probe) => record(current, ms, probe));
    prototype[installed] = true;
  }
}
