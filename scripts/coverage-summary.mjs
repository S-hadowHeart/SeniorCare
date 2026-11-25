import { appendFile, readFile } from "node:fs/promises";

/**
 * Render the Vitest coverage summaries as a Markdown table.
 *
 * CI appends the table to `$GITHUB_STEP_SUMMARY`; locally the same command
 * prints it to stdout. Missing reports are shown as `n/a` so that a failed
 * suite still produces a useful summary step.
 */
const REPORTS = [
  ["API", "server/coverage/coverage-summary.json"],
  ["Web", "web/coverage/coverage-summary.json"],
];

async function row(label, path) {
  try {
    const summary = JSON.parse(await readFile(path, "utf8"));
    const total = summary.total;
    return `| ${label} | ${total.statements.pct}% | ${total.branches.pct}% | ${total.functions.pct}% | ${total.lines.pct}% |`;
  } catch {
    return `| ${label} | n/a | n/a | n/a | n/a |`;
  }
}

const rows = await Promise.all(REPORTS.map(([label, path]) => row(label, path)));

const markdown = [
  "## Test coverage",
  "",
  "| Suite | Statements | Branches | Functions | Lines |",
  "| --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
}

console.log(markdown);
