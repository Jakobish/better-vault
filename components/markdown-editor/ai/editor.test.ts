// @vitest-environment jsdom

import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { history, undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownAiEditor } from "./editor";

const closer: (() => void)[] = [];
afterEach(() => closer.splice(0).forEach((close) => close()));

function setup(doc: string, confirmOverlap = vi.fn(() => false)) {
    const ai = createMarkdownAiEditor({
        config: () => ({ documentKind: "note", getContext: () => ({ title: "Note" }) }),
        label: () => "Ask AI",
        confirmOverlap,
    });
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [
                history(),
                ai.extension,
                autocompletion({ override: [ai.completion], interactionDelay: 0 }),
                EditorView.updateListener.of(ai.update),
            ],
        }),
    });
    ai.attach(view);
    closer.push(() => {
        ai.destroy();
        view.destroy();
        parent.remove();
    });
    return { ai, view, text: () => view.state.doc.toString(), confirmOverlap };
}

describe("Markdown AI editor", () => {
    it("streams out of the document, maps hunks and commits once with one undo", async () => {
        const { ai, view, text } = setup("before\nfirst\nkeep\nlast\nafter");
        view.focus();
        view.dispatch({ selection: { anchor: 7, head: 22 } });
        await vi.waitFor(() => expect(ai.snapshot().selectionMenu).toBe(true));
        expect(ai.start("rewrite")).toBe(true);
        const { signal, request } = ai.begin()!;
        expect(request.original).toBe("first\nkeep\nlast");
        const before = text();
        ai.chunk(signal, "new");
        expect(ai.snapshot().preview).toBe("new");
        expect(ai.snapshot().previewElement?.isConnected).toBe(true);
        expect(text()).toBe(before);
        view.dispatch({
            changes: [
                { from: 0, insert: "Intro\n" },
                { from: before.length, insert: "!" },
            ],
        });
        ai.complete(signal, "new\nkeep\nfinal");
        const hunks = ai.snapshot().hunks;
        expect(hunks).toHaveLength(2);
        expect(hunks.map((hunk) => hunk.line)).toEqual([3, 5]);
        ai.decide("accept", hunks[0].id);
        ai.commit();
        expect(text()).toBe("Intro\n" + before + "!");
        ai.decide("reject", hunks[1].id);
        ai.commit();
        expect(text()).toBe("Intro\nbefore\nnew\nkeep\nlast\nafter!");
        expect(
            view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
        ).toBe("new\n");
        expect(undo(view)).toBe(true);
        expect(text()).toBe("Intro\n" + before + "!");
    });

    it("requires confirmation for overlapping edits and discards late chunks", () => {
        const confirm = vi
            .fn(() => false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const { ai, view, text } = setup("abcd", confirm);
        view.dispatch({ selection: { anchor: 1, head: 3 } });
        ai.start("rewrite");
        const { signal } = ai.begin()!;
        const edit = { changes: { from: 2, insert: "!" } };
        view.dispatch(edit);
        expect(text()).toBe("abcd");
        expect(signal.aborted).toBe(false);
        view.dispatch(edit);
        expect(text()).toBe("ab!cd");
        expect(signal.aborted).toBe(true);
        ai.chunk(signal, "late");
        ai.complete(signal, "late");
        expect(ai.snapshot().status).toBe("idle");
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it("rolls back a failed refinement and aborts on destruction", () => {
        const { ai, view } = setup("Original.");
        view.dispatch({ selection: { anchor: 0, head: 9 } });
        ai.start("custom");
        ai.instruct("First instruction");
        ai.complete(ai.begin()!.signal, "First proposal");
        ai.decide("accept");
        ai.refine();
        expect(ai.snapshot().instruction).toBe("First instruction");
        ai.instruct("Shorter");
        const process = ai.begin()!;
        expect(process.request).toMatchObject({
            previous: "First proposal",
            original: "Original.",
            instruction: "Shorter",
        });
        expect(ai.snapshot().hunks[0].decision).toBeUndefined();
        ai.chunk(process.signal, "Partial");
        ai.fail(process.signal);
        ai.resumeReview();
        expect(ai.snapshot().proposal).toBe("First proposal");
        expect(ai.snapshot().hunks[0].element.isConnected).toBe(true);
        const retry = ai.begin(true)!;
        expect(retry.request).toEqual(process.request);
        ai.destroy();
        expect(retry.signal.aborted).toBe(true);
    });

    it("offers the slash completion and leaves no saved trigger or undo step", async () => {
        const { ai, view, text } = setup("Body ");
        view.focus();
        view.dispatch({ selection: { anchor: 5 } });
        for (const ch of "/ai") {
            const at = view.state.selection.main.head;
            view.dispatch({
                changes: { from: at, insert: ch },
                selection: { anchor: at + 1 },
                userEvent: "input.type",
            });
            expect(ai.savedText(view.state)).toBe("Body ");
        }
        await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
        expect(text()).toBe("Body ");
        expect(undoDepth(view.state)).toBe(0);
        expect(ai.snapshot().status).toBe("scoping");
        ai.chooseScope("insert");
        expect(ai.requestData()).toMatchObject({ target: { from: 5, to: 5 }, markdown: "Body " });
    });
});
