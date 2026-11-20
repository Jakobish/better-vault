import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { maxMarkdownContext, maxTarget, type MarkdownAiScope, type Target } from "./request";

export function markdownBlocks(markdown: string) {
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/)?.[0];
  const front = frontmatter?.length ?? 0;
  const tree = fromMarkdown(markdown.slice(front), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const blocks = tree.children.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return [];
    return [{ from: from + front, to: to + front, depth: node.type === "heading" ? node.depth : 0 }];
  });
  if (front) blocks.unshift({ from: 0, to: front, depth: 0 });
  return blocks;
}

export function scopeTarget(markdown: string, cursor: number, scope: MarkdownAiScope): Target | null {
  if (scope === "whole") return { from: 0, to: markdown.length };
  if (scope === "insert") return { from: cursor, to: cursor };
  if (!markdown.length) return null;
  const blocks = markdownBlocks(markdown);
  if (scope === "block") {
    const block = blocks.find(({ from, to }) => from <= cursor && cursor <= to);
    return block ? { from: block.from, to: block.to } : null;
  }
  const headings = blocks.filter(({ depth }) => depth > 0);
  const current = headings.findLastIndex(({ from }) => from <= cursor);
  const heading = headings[current];
  const next = headings.slice(current + 1).find(({ depth }) => !heading || depth <= heading.depth);
  return { from: heading?.from ?? 0, to: next?.from ?? markdown.length };
}

/** Pick the longest slice around the target, preferring balanced context for ties. */
export function budgetContext(markdown: string, target: Target, budget: number) {
  budget = Math.min(budget, maxMarkdownContext);
  const original = markdown.slice(target.from, target.to);
  const splitsPair = (offset: number) =>
    /[\uD800-\uDBFF]/.test(markdown.charAt(offset - 1)) &&
    /[\uDC00-\uDFFF]/.test(markdown.charAt(offset));
  if (original.length > Math.min(budget, maxTarget) || splitsPair(target.from) || splitsPair(target.to))
    return null;
  if (markdown.length <= budget) return { markdown, target, original, partial: false };

  const boundaries = [...new Set([0, ...markdownBlocks(markdown).flatMap(({ from, to }) => [from, to]), markdown.length])].sort((a, b) => a - b);
  const left = boundaries.filter((at) => at <= target.from);
  const right = boundaries.filter((at) => at >= target.to);
  let end = 0;
  let best: Target | undefined;
  const imbalance = ({ from, to }: Target) => Math.abs(target.from - from - (to - target.to));
  for (const from of left) {
    while (end < right.length && right[end] - from <= budget) end++;
    const to = right[end - 1];
    if (to === undefined) continue;
    if (!best || to - from > best.to - best.from ||
      (to - from === best.to - best.from && imbalance({ from, to }) < imbalance(best))) {
      best = { from, to };
    }
  }
  // A single giant Markdown block can still contain a valid, smaller selection.
  const { from, to } = best ?? target;
  return {
    markdown: markdown.slice(from, to),
    target: { from: target.from - from, to: target.to - from },
    original,
    partial: true,
  };
}
