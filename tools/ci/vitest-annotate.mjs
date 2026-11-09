// Turns the JSON report of Vitest into GitHub annotations, for a run whose logs
// cannot be read without signing in: the failing tests are in the annotations.
//
//   node tools/ci/vitest-annotate.mjs <report.json> [<title prefix>]
//
// One annotation lists every failing test (« file › test: first line of the error »),
// then up to 9 more, one per failing file, are put on the file and the line.

const MAX_BYTES = 60_000;
const MAX_FILES = 9;

/** The first non-empty line of an error, without the colour codes. */
function firstLine(message) {
  // oxlint-disable-next-line no-control-regex
  const plain = String(message ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  return plain.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
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
        message: firstLine(test.failureMessages?.[0]),
      });
    }
    // A file that did not run at all (an error at import) has no test, only a message.
    if (suite.status === "failed" && tests.length === 0) {
      found.push({ file, name: "(le fichier)", line: 1, message: firstLine(suite.message) });
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
