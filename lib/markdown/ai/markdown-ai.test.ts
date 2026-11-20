import { describe, expect, it } from "vitest";
import { budgetContext, scopeTarget } from "./context";
import { acceptedChanges, reviewHunks } from "./review";

describe("Markdown editing targets", () => {
    const doc =
        "---\ntags: [test]\n---\n\nפתיחה 🌈\n\n# One\n\n- [x] first\n- [ ] second\n\n## Child\n\n```md\n# Not a heading\n```\n\nTwo\n===\n";
    const extract = (text: string, scope: "block" | "section") => {
        const at = scopeTarget(doc, doc.indexOf(text), scope);
        return at && doc.slice(at.from, at.to);
    };

    it("finds actual blocks and headings in mixed Markdown", () => {
        expect(extract("tags:", "block")).toBe("---\ntags: [test]\n---");
        expect(extract("פתיחה", "block")).toBe("פתיחה 🌈");
        expect(extract("second", "block")).toBe("- [x] first\n- [ ] second");
        expect(extract("Not a heading", "block")).toBe("```md\n# Not a heading\n```");
        expect(extract("פתיחה", "section")).toBe(doc.slice(0, doc.indexOf("# One")));
        expect(extract("first", "section")).toBe(
            doc.slice(doc.indexOf("# One"), doc.indexOf("Two")),
        );
        expect(extract("Not a heading", "section")).toBe(
            doc.slice(doc.indexOf("## Child"), doc.indexOf("Two")),
        );
        expect(scopeTarget("", 0, "block")).toBeNull();
        expect(scopeTarget("", 0, "section")).toBeNull();
        expect(scopeTarget("", 0, "whole")).toEqual({ from: 0, to: 0 });
        expect(scopeTarget("", 0, "insert")).toEqual({ from: 0, to: 0 });
    });

    it("keeps the complete target and trims at block boundaries", () => {
        const markdown = "Before\n\n😀 middle\n\nAfter";
        const target = { from: 11, to: 17 };
        expect(budgetContext(markdown, target, 16)).toEqual({
            markdown: "😀 middle\n\nAfter",
            target: { from: 3, to: 9 },
            original: "middle",
            partial: true,
        });
        expect(budgetContext(markdown, { from: 9, to: 11 }, 80)).toBeNull();
        expect(budgetContext(markdown, target, 5)).toBeNull();
        expect(budgetContext(markdown, target, 80)?.partial).toBe(false);
    });
});

describe("Markdown review", () => {
    it("groups adjacent changes and builds only accepted edits", () => {
        const original = "one\ntwo\ncommon\nlast";
        const next = "three\ncommon\nend";
        const [first, last] = reviewHunks(original, next);
        expect(first).toMatchObject({ id: "0:8:0:6", removed: "one\ntwo\n", added: "three\n" });
        expect(last).toMatchObject({ removed: "last", added: "end" });
        expect(
            acceptedChanges({ from: 10, to: 10 + original.length }, [
                { ...first, decision: "reject" },
                { ...last, decision: "accept" },
            ]),
        ).toEqual([{ from: 25, to: 29, insert: "end" }]);
        expect(reviewHunks(original, original)).toEqual([]);
        expect(reviewHunks("", next)).toMatchObject([{ from: 0, to: 0, added: next }]);
        expect(reviewHunks(original, "")).toMatchObject([
            { from: 0, to: original.length, added: "" },
        ]);
    });
});
