// @vitest-environment jsdom

import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";
import { createI18n } from "@/lib/i18n/create-i18n";
import { MarkdownEditor } from "./markdown-editor";

it("runs host extensions and completions without opting into AI", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const parent = document.createElement("div");
    document.body.append(parent);
    const root = createRoot(parent);
    const onChange = vi.fn();
    const configure = () => ({
        extensions: [EditorView.contentAttributes.of({ "data-host-extension": "active" })],
        completions: [() => ({ from: 0, options: [{ label: "host completion" }] })],
    });
    try {
        await act(async () =>
            root.render(
                <I18nextProvider i18n={createI18n("en")}>
                    <MarkdownEditor
                        docId="skill"
                        value=""
                        onChange={onChange}
                        label="Skill"
                        configure={configure}
                    />
                </I18nextProvider>,
            ),
        );
        const content = parent.querySelector<HTMLElement>(".cm-content")!;
        const view = EditorView.findFromDOM(content)!;
        expect(content.dataset.hostExtension).toBe("active");
        view.focus();
        startCompletion(view);
        await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
        expect(onChange).toHaveBeenLastCalledWith("host completion");
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        expect(parent.querySelector("[data-markdown-ai]")).toBeNull();
        expect(parent.querySelector("[role='status'][aria-live='polite']")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        parent.remove();
        vi.unstubAllGlobals();
    }
});
