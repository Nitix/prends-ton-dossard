// What to do when the first browser run of a target fails on a cold cache of Vite: run again only
// the files that could not be imported, then judge the two runs together.
//
//   node tools/ci/cold-cache.mjs files <report.json> <log>
//     Prints the files to run again, one per line, and exits 0. Prints nothing and exits 0 when the
//     whole suite has to run again (an error outside of a test, with the signature of the
//     re-optimisation in the log). Exits 1 when nothing warrants a second run.
//   node tools/ci/cold-cache.mjs merge <first.json> <second.json> <merged.json>
//     Writes the first report with the second one's files in place of the files it run again, and
//     exits 1 if any file of the result failed.
//
// Why only those files: a cold cache makes the files that cannot be imported, and nothing else.
// Running the whole suite again needed every failed file to be one of them, so that a real failure
// elsewhere in the same run (a flaky test of Firefox, say) forbade the second run, and the
// import failures stayed red with it. Now the second run covers the imports, and the failures that
// are real stay in the merged report, where they fail the job.
//
// It is decided from the JSON: a failed file with no test result at all did not import. A failed
// test is a real failure, whatever its message says, and so is an error outside of a test (the
// "Unhandled Errors" section of the log) that is not the cold cache: nothing is run again then.
// Each error of that section is judged on its own, whatever the type on its banner (one cold-cache
// error does not vouch for a real one), and a section with no error under its banner is not
// understood: red. The whole suite is run again when no file failed, the log has the signature
// and, if there is such a section, each of its errors has it. The "Vite unexpectedly reloaded"
// warning is printed during the run, never inside the section: a reload followed by an unrelated
// unhandled error is red, with no second run, on purpose.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Chromium, Firefox and WebKit word a failed dynamic import differently.
const SIGNATURE =
  /Vite unexpectedly reloaded|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/;

// The banner of the unhandled errors in Vitest 5's default reporter (printUnhandledErrors), up to
// its own closing line of dashes (not the one inside an error, before "Serialized Error:", that
// printStack writes for the own properties of an error; the github-actions lines after it are not
// part of it), or the summary. The JSON report does not record these errors, yet they fail the run.
const UNHANDLED = /Unhandled Errors[\s\S]*?(?=\n\u23af+(?:\n(?!Serialized Error:)|$)|\n\s*Test Files|$)/;
// One banner per error (printErrorType, errorBanner): its type, with dashes round it, on a line of
// its own, whatever the type is. The dashes are optional: they fill a terminal's width, so a
// title of 29 columns or more leaves none on one side (CI), and a banner needing both would glue
// that error to the one before it. The browser reports an exception thrown in an event handler, a timer
// or a React callback as "Error", a rejected promise as "Unhandled Rejection", and the tester and
// the server use "Run Error", "Browser Error" and others: knowing only some of them would glue a
// real error to the cold-cache one before it. The line of dashes before "Serialized Error:" has
// no title, so it does not split. The section starts at the title of its own banner, so that
// banner is not matched: what comes before the first error's banner is the header.
const ERROR_BANNER = /\n\u23af* \S[^\n\u23af]*\S \u23af*\n/;
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

const resultsOf = (report) => (Array.isArray(report?.testResults) ? report.testResults : []);
const testsOf = (file) => file.assertionResults ?? [];

/**
 * The files to run again: their names, as the report has them (an empty list: the whole suite),
 * or null when the failure is not a cold cache.
 * @returns {string[] | null}
 */
export function filesToRerun(report, log) {
  const text = stripAnsi(String(log ?? ""));
  // An unhandled error that is not the cold cache is a real failure: running the files again
  // would end green and hide it.
  const unhandled = UNHANDLED.exec(text)?.[0];
  if (unhandled !== undefined) {
    // [0] is the banner and its sentence; each error follows its own banner.
    const errors = unhandled.split(ERROR_BANNER).slice(1);
    if (errors.length === 0 || errors.some((error) => !SIGNATURE.test(error))) return null;
  }
  const failed = resultsOf(report).filter((file) => file.status === "failed");
  const noImport = failed.filter((file) => testsOf(file).length === 0);
  if (noImport.length > 0) return noImport.map((file) => String(file.name));
  // Only failed tests, or nothing failed at all: an error outside of a test needs the signature.
  if (failed.length > 0) return null;
  return SIGNATURE.test(text) ? [] : null;
}

/** The first report, with the files of the second in place of those the second run covered. */
export function mergeReports(first, second) {
  const again = new Set(resultsOf(second).map((file) => file.name));
  const testResults = [
    ...resultsOf(first).filter((file) => !again.has(file.name)),
    ...resultsOf(second),
  ];
  const failedFiles = testResults.filter((file) => file.status === "failed").length;
  return { ...first, testResults, numFailedTestSuites: failedFiles, success: failedFiles === 0 };
}

function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1]?.endsWith("cold-cache.mjs")) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "files") {
    const [path, logPath] = args;
    if (!path || !existsSync(path)) process.exit(1);
    const log = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const files = filesToRerun(read(path), log);
    if (files === null) process.exit(1);
    if (files.length > 0) console.log(files.join("\n"));
  } else if (command === "merge") {
    const [firstPath, secondPath, outPath] = args;
    if (!firstPath || !secondPath || !outPath || !existsSync(secondPath)) process.exit(1);
    const merged = mergeReports(read(firstPath), read(secondPath));
    writeFileSync(outPath, JSON.stringify(merged));
    process.exit(merged.success ? 0 : 1);
  } else {
    process.exit(2);
  }
}
