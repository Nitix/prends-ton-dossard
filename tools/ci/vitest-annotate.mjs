// Turns the JSON report of Vitest into GitHub annotations, for a run whose logs
// cannot be read without signing in: the failing tests are in the annotations.
//
//   node tools/ci/vitest-annotate.mjs <report.json> [<title prefix>]
//
// One annotation lists every failing test (« file › test: first line of the error »),
// then up to 9 more, one per failing file, are put on the file and the line.

const MAX_BYTES = 60_000;
const MAX_FILES = 9;

/** A line of a stack: V8's « at … », Firefox's and WebKit's « fn@http://… » and « @[native code] ». */
const STACK_FRAME = [/^\s*at\s/, /@\[native code\]/, /^\s*(?:async\s+)?\S*@(?:https?|file):/, /^\s*$/];

const MAX_LINE = 300;

// The call log of a Playwright timeout: its last steps, each cut, so that the HTML of an element
// (a button with its classes) does not hide the step where it stopped.
const CALL_LOG_STEPS = 10;
const CALL_LOG_STEP = 160;

/** A text cut to `max` characters, the last one an ellipsis. */
function cut(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What an error says, from the text Vitest gives for it: the first line that is not a stack
 * frame (Firefox and WebKit write a stack without the message, so the assertion may be later, or
 * absent: then `name: message` of the error, when the report has them). About 300 characters.
 */
function firstLine(message, error) {
  // oxlint-disable-next-line no-control-regex
  const plain = String(message ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  let line = plain.split("\n").find((one) => !STACK_FRAME.some((frame) => frame.test(one)))?.trim();
  if (!line && error?.message) line = `${error.name ?? "Error"}: ${error.message}`.split("\n")[0];
  if (!line) line = plain.split("\n").find((one) => one.trim() !== "")?.trim() ?? "";
  if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE - 1)}…`;
  // A Playwright timeout says why in its call log (« intercepts pointer events », « not stable »):
  // the last steps of it are kept, each cut on its own.
  const log = plain.split("Call log:")[1];
  if (log) {
    const lines = log
      .split("\n")
      .map((one) => one.trim())
      .filter((one) => one !== "" && !STACK_FRAME.some((frame) => frame.test(one)));
    const steps = lines.slice(-CALL_LOG_STEPS).map((one) => cut(one, CALL_LOG_STEP));
    line += ` [${steps.join(" / ")}]`;
  }
  return line;
}

/** The text of a workflow command's data: `%`, CR and LF are escaped. */
export function escapeData(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** The text of a workflow command's property: also `:` and `,`. */
export function escapeProperty(text) {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** The failing tests of a Vitest JSON report: { file, name, line, message }. */
export function failures(report, root = process.cwd()) {
  const found = [];
  for (const suite of report.testResults ?? []) {
    const file = String(suite.name ?? "")
      .replaceAll("\\", "/")
      .replace(`${root.replaceAll("\\", "/")}/`, "");
    const tests = (suite.assertionResults ?? []).filter((test) => test.status === "failed");
    for (const test of tests) {
      found.push({
        file,
        name: test.fullName ?? test.title ?? "",
        line: test.location?.line ?? 1,
        message: firstLine(test.meta?.failure ?? test.failureMessages?.[0], test.failureDetails?.[0]),
      });
    }
    // A file that did not run at all (an error at import) has no test, only a message.
    if (suite.status === "failed" && tests.length === 0) {
      found.push({ file, name: "(le fichier)", line: 1, message: firstLine(suite.message, undefined) });
    }
  }
  return found;
}

/**
 * The tests that failed and then passed on a retry: Vitest keeps the errors of the attempts that
 * failed on a test that ends passed. { file, name, line, attempts, message }.
 */
export function flaky(report, root = process.cwd()) {
  const found = [];
  for (const suite of report.testResults ?? []) {
    const file = String(suite.name ?? "")
      .replaceAll("\\", "/")
      .replace(`${root.replaceAll("\\", "/")}/`, "");
    for (const test of suite.assertionResults ?? []) {
      const errors = test.failureMessages ?? [];
      if (test.status !== "passed" || errors.length === 0) continue;
      found.push({
        file,
        name: test.fullName ?? test.title ?? "",
        line: test.location?.line ?? 1,
        attempts: errors.length + 1,
        message: firstLine(test.meta?.failure ?? errors[0], undefined),
      });
    }
  }
  return found;
}

/** The warnings for the flaky tests: the list in one, then one per file (9 at most). */
export function flakyAnnotations(list, title = "Tests instables") {
  if (list.length === 0) return [];
  const body = list
    .map((one) => `${one.file} › ${one.name} (réussi au ${one.attempts}e essai): ${one.message}`)
    .join(String.fromCharCode(10));
  const out = [
    `::warning title=${escapeProperty(`${title} (${list.length})`)}::${escapeData(body.slice(0, MAX_BYTES / 2))}`,
  ];
  const byFile = new Map();
  for (const one of list) if (!byFile.has(one.file)) byFile.set(one.file, one);
  for (const one of [...byFile.values()].slice(0, MAX_FILES)) {
    out.push(
      `::warning file=${escapeProperty(one.file)},line=${one.line},title=${escapeProperty(`Test instable (réussi au ${one.attempts}e essai)`)}::${escapeData(`${one.name}: ${one.message}`)}`,
    );
  }
  return out;
}

/**
 * A run that failed with no test failed: Vitest reports unhandled errors (an error thrown outside
 * a test) as a failed run. The annotation holds the « Unhandled Errors » section of the log, or
 * its last 40 lines.
 */
export function silentFailure(report, log) {
  if (report.success !== false || failures(report).length > 0) return [];
  // oxlint-disable-next-line no-control-regex
  const lines = String(log ?? "").replace(/\u001b\[[0-9;]*m/g, "").split(String.fromCharCode(10));
  const at = lines.findIndex((line) => line.includes("Unhandled Error"));
  const shown = at >= 0 ? lines.slice(at, at + 40) : lines.slice(-40);
  const text = shown.join(String.fromCharCode(10)).trim() || "(pas de journal)";
  return [
    `::error title=${escapeProperty("La suite a échoué sans test en échec")}::${escapeData(text.slice(0, 3500))}`,
  ];
}

/** The workflow commands for a list of failures. */
export function annotations(list, title = "Tests en échec") {
  if (list.length === 0) return [];
  const lines = list.map((one) => `${one.file} › ${one.name}: ${one.message}`);
  let body = "";
  let shown = 0;
  for (const line of lines) {
    const next = `${body}${shown === 0 ? "" : "\n"}${line}`;
    if (Buffer.byteLength(escapeData(next)) > MAX_BYTES) break;
    body = next;
    shown += 1;
  }
  if (shown < lines.length) body += `\n… et ${lines.length - shown} de plus`;
  const out = [
    `::error title=${escapeProperty(`${title} (${list.length})`)}::${escapeData(body)}`,
  ];
  const byFile = new Map();
  for (const one of list) if (!byFile.has(one.file)) byFile.set(one.file, one);
  for (const one of [...byFile.values()].slice(0, MAX_FILES)) {
    out.push(
      `::error file=${escapeProperty(one.file)},line=${one.line},title=${escapeProperty(one.name)}::${escapeData(one.message)}`,
    );
  }
  return out;
}

/** « Tests en échec — Chrome » gives « Tests instables — Chrome »: what follows the first dash is kept. */
export function flakyTitle(title) {
  return `Tests instables — ${String(title).replace(/^[^—]*—\s*/, "")}`;
}

// Diagnostic of round 21 (branch diag/safari-clicks only): the clicks that web/src/test/clickProbe.ts
// timed on WebKit on CI. Each test keeps the time of all its clicks (`meta.clickMs`) and a record of
// each one that took more than 1.5 s or threw (`meta.clickProbe`).

/** « Tests en échec — Safari #3 » gives « Clics lents — Safari #3 ». */
export function probeTitle(title) {
  return `Clics lents — ${String(title).replace(/^[^—]*—\s*/, "")}`;
}

/** The records of the slow clicks, with their file and test: { file, name, ...record }. */
export function clickProbes(report, root = process.cwd()) {
  const found = [];
  for (const suite of report.testResults ?? []) {
    const file = String(suite.name ?? "")
      .replaceAll("\\", "/")
      .replace(`${root.replaceAll("\\", "/")}/`, "");
    for (const test of suite.assertionResults ?? []) {
      for (const record of test.meta?.clickProbe ?? []) {
        found.push({ file, name: test.fullName ?? test.title ?? "", ...record });
      }
    }
  }
  return found;
}

/** The time of every click of the run, in ms. */
export function clickTimes(report) {
  return (report.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? []).flatMap((test) => test.meta?.clickMs ?? []),
  );
}

/** The value at the share `p` of sorted numbers (nearest rank). */
function rank(sorted, p) {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/** One slow click on one line: what the page, the frame and Node said during it. */
function probeLine(one) {
  const parts = [
    `${one.file} › ${one.name} [essai ${(one.attempt ?? 0) + 1}] ${one.ms} ms${one.error ? ` ${one.error}` : ""}`,
  ];
  const doc = one.doc ?? {};
  const top = one.top ? `, autour ${one.top.visibility} focus=${one.top.focus}` : ", autour ?";
  parts.push(`page ${doc.visibility} hidden=${doc.hidden} focus=${doc.focus}${top}`);
  const raf = one.raf ?? {};
  parts.push(
    `rAF ${raf.total}, écart max ${raf.maxGap} ms, 1er à ${raf.first ?? "—"} ms, par 500 ms : ${(raf.per500 ?? []).join(" ")}`,
  );
  const timer = one.timer ?? {};
  parts.push(
    `setTimeout(0) ${timer.total}, écart max ${timer.maxGap} ms, par 500 ms : ${(timer.per500 ?? []).join(" ")}`,
  );
  const events = Object.entries(one.events ?? {});
  parts.push(
    `évènements (ms) : ${events.length === 0 ? "aucun" : events.map(([type, at]) => `${type} ${at}`).join(" ")}`,
  );
  parts.push(`iframe ${one.frame ?? "?"}`);
  parts.push(`cible au début ${one.targetStart ?? "?"} ; à la fin ${one.target ?? "?"}`);
  const node = one.node;
  if (node && "error" in node) parts.push(`Node : ${node.error}`);
  else if (node) {
    parts.push(
      `Node : retard max ${node.maxLag} ms, par 500 ms : ${(node.per500 ?? []).join(" ")}, > 100 ms ×${node.over100}, ${node.samples} relevés, appel ${node.rpcMs} ms, charge ${(node.load ?? []).join(" ")}, ${node.contexts} contextes`,
    );
  } else parts.push("Node : ?");
  return parts.join(" | ");
}

/**
 * One notice: how the clicks of the run were spread, then each slow click, the slowest first.
 * A run with clicks and no slow one still says how many were timed, so a probe that ran is told
 * apart from one that did not; a run with no timed click (the probe off) gives nothing.
 */
export function clickProbeAnnotations(list, times, title = "Clics lents") {
  if (list.length === 0 && times.length === 0) return [];
  const sorted = [...times].sort((a, b) => a - b);
  const between = (low, high) => list.filter((one) => one.ms >= low && one.ms < high).length;
  const head = [
    `Clics lents ou en échec : ${list.length} sur ${times.length} clics mesurés.`,
    sorted.length > 0
      ? `Durée des clics : médiane ${rank(sorted, 0.5)} ms, p90 ${rank(sorted, 0.9)} ms, p99 ${rank(sorted, 0.99)} ms, max ${sorted.at(-1)} ms.`
      : "",
    `1,5–2 s : ${between(1500, 2000)} · 2–3 s : ${between(2000, 3000)} · 3–5 s : ${between(3000, 5000)} · ≥ 5 s : ${between(5000, Infinity)} · en échec : ${list.filter((one) => one.error).length}`,
  ]
    .filter((one) => one !== "")
    .join("\n");
  let body = head;
  let shown = 0;
  const lines = [...list].sort((a, b) => b.ms - a.ms).map(probeLine);
  for (const line of lines) {
    const next = `${body}\n${line}`;
    if (Buffer.byteLength(escapeData(next)) > MAX_BYTES) break;
    body = next;
    shown += 1;
  }
  if (shown < lines.length) body += `\n… et ${lines.length - shown} de plus`;
  return [`::notice title=${escapeProperty(`${title} (${list.length})`)}::${escapeData(body)}`];
}

if (process.argv[1]?.endsWith("vitest-annotate.mjs")) {
  const { readFileSync, existsSync } = await import("node:fs");
  // --flaky-only: the report of a first run that was run again (a cold cache of Vite): its tests that
  // passed on a retry are still warnings, but its failures are not, since the second run answers.
  const args = process.argv.slice(2);
  const flakyOnly = args.includes("--flaky-only");
  const [path, title, logPath] = args.filter((one) => one !== "--flaky-only");
  if (!path || !existsSync(path)) {
    console.log(`::error title=Rapport Vitest absent::${escapeData(String(path))} n'existe pas : Vitest n'a pas fini.`);
  } else {
    const report = JSON.parse(readFileSync(path, "utf8"));
    const log = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    for (const line of [
      ...(flakyOnly ? [] : annotations(failures(report), title)),
      ...(flakyOnly ? [] : silentFailure(report, log)),
      ...flakyAnnotations(flaky(report), flakyTitle(title)),
      // The slow clicks of the probe (round 21), from the final report only: a merged report keeps
      // the tests of the first run that were not run again, so they would be told twice.
      ...(flakyOnly
        ? []
        : clickProbeAnnotations(clickProbes(report), clickTimes(report), probeTitle(title))),
    ]) {
      console.log(line);
    }
  }
}
