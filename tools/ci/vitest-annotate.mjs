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

/**
 * What an error says, from the text Vitest gives for it: the first line that is not a stack
 * frame (Firefox and WebKit write a stack without the message, so the assertion may be later, or
 * absent: then `name: message` of the error, when the report has them). About 300 characters.
 */
function firstLine(message, error) {
  // oxlint-disable-next-line no-control-regex
  const plain = String(message ?? "").replace(/[[0-9;]*m/g, "");
  let line = plain.split("\n").find((one) => !STACK_FRAME.some((frame) => frame.test(one)))?.trim();
  if (!line && error?.message) line = `${error.name ?? "Error"}: ${error.message}`.split("\n")[0];
  if (!line) line = plain.split("\n").find((one) => one.trim() !== "")?.trim() ?? "";
  if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE - 1)}…`;
  // A Playwright timeout says why in its call log (« intercepts pointer events », « not stable »):
  // the last lines of it are kept.
  const log = plain.split("Call log:")[1];
  if (log) {
    const lines = log
      .split("\n")
      .map((one) => one.trim())
      .filter((one) => one !== "" && !STACK_FRAME.some((frame) => frame.test(one)));
    line += ` [${lines.slice(-4).join(" / ").slice(0, 400)}]`;
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

if (process.argv[1]?.endsWith("vitest-annotate.mjs")) {
  const { readFileSync, existsSync } = await import("node:fs");
  const [path, title] = process.argv.slice(2);
  if (!path || !existsSync(path)) {
    console.log(`::error title=Rapport Vitest absent::${escapeData(String(path))} n'existe pas : Vitest n'a pas fini.`);
  } else {
    for (const line of annotations(failures(JSON.parse(readFileSync(path, "utf8"))), title)) {
      console.log(line);
    }
  }
}
