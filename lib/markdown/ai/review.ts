import { diffLines } from "diff";
import type { Target } from "./request";

export interface Hunk {
  id: string;
  from: number;
  to: number;
  removed: string;
  added: string;
  decision?: "accept" | "reject";
}

export function reviewHunks(original: string, proposal: string): Hunk[] {
  // Bound the edit distance for highly divergent documents.
  const changes = diffLines(original, proposal, { maxEditLength: 4000 }) ??
    [{ value: original, removed: true, added: false }, { value: proposal, added: true, removed: false }];
  const hunks: Hunk[] = [];
  let from = 0;
  let proposedFrom = 0;
  let removed = "";
  let added = "";
  function flush() {
    if (!removed && !added) return;
    const to = from + removed.length;
    const proposedTo = proposedFrom + added.length;
    hunks.push({ id: `${from}:${to}:${proposedFrom}:${proposedTo}`, from, to, removed, added });
    from = to;
    proposedFrom = proposedTo;
    removed = added = "";
  }
  for (const change of changes) {
    if (change.added) added += change.value;
    else if (change.removed) removed += change.value;
    else {
      flush();
      from += change.value.length;
      proposedFrom += change.value.length;
    }
  }
  flush();
  return hunks;
}

export function acceptedChanges(target: Target, hunks: Hunk[]) {
  return hunks.flatMap(({ from, to, added, decision }) =>
    decision === "accept" ? [{ from: target.from + from, to: target.from + to, insert: added }] : [],
  );
}
