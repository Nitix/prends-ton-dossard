// Says (exit code 0) whether a failed browser run looks like a cold cache of Vite, so the suite is
// run again; any other failure exits 1 and stays a failure.
//
//   node tools/ci/cold-cache.mjs <report.json> <log>
//
// It is decided from the JSON: a cold cache makes files that cannot be imported, so every failed
// file of the report has no test result at all. A failed test is a real failure, whatever its
// message says. When the report has no failed file (an error thrown outside of a test fails the
// run), the log has to carry the signature of the re-optimisation.

import { existsSync, readFileSync } from "node:fs";

const SIGNATURE = /Vite unexpectedly reloaded|Failed to fetch dynamically imported module/;

/** @returns {boolean} */
export function isColdCache(report, log) {
  const files = Array.isArray(report?.testResults) ? report.testResults : [];
  const failed = files.filter((file) => file.status === "failed");
  if (failed.some((file) => (file.assertionResults ?? []).some((test) => test.status === "failed"))) {
    return false;
  }
  if (failed.length > 0) return failed.every((file) => (file.assertionResults ?? []).length === 0);
  return SIGNATURE.test(String(log ?? ""));
}

if (process.argv[1]?.endsWith("cold-cache.mjs")) {
  const [path, logPath] = process.argv.slice(2);
  if (!path || !existsSync(path)) process.exit(1);
  const report = JSON.parse(readFileSync(path, "utf8"));
  const log = logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  process.exit(isColdCache(report, log) ? 0 : 1);
}
