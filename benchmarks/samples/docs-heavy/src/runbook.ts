export function runbookSteps() {
  return [
    "rebuild docsSearchIndex",
    "publish docs route manifest",
    "verify /docs/runbook",
  ];
}
