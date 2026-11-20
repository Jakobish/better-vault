import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    type CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import {
    drawSelection,
    EditorView,
    keymap,
    placeholder as placeholderText,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    createMarkdownAiEditor,
    type MarkdownAiEditingConfig,
    type MarkdownAiEditor,
} from "./ai/editor";
import { MarkdownAiControls } from "./ai/editor-controls";
import { markdownHighlight, markdownTheme } from "./theme";

export interface MarkdownEditorHandle {
    focus: () => void;
    /** Puts the cursor at a character offset and scrolls it into view. */
    reveal: (offset: number) => void;
}

interface MarkdownEditorProps {
    docId: string;
    value: string;
    onChange: (value: string) => void;
    configure?: () => {
        extensions?: readonly Extension[];
        completions?: readonly CompletionSource[];
    };
    placeholder?: string;
    label: string;
    aiEditing?: MarkdownAiEditingConfig;
}

/** A Markdown editing surface. The host supplies document persistence and extensions. */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
    function MarkdownEditor(
        { docId, value, onChange, configure, placeholder, label, aiEditing },
        ref,
    ) {
        const host = useRef<HTMLDivElement>(null);
        const view = useRef<EditorView | null>(null);
        const [contentAttributes] = useState(() => new Compartment());
        const reported = useRef<string[]>([]);
        const [ai, setAi] = useState<MarkdownAiEditor>();
        const { t } = useTranslation("markdownEditor", { keyPrefix: "ai" });
        const latest = useRef({ onChange, aiEditing, t });
        latest.current = { onChange, aiEditing, t };
        const aiEnabled = aiEditing !== undefined;

        useImperativeHandle(ref, () => ({
            focus: () => view.current?.focus(),
            reveal: (offset) => {
                const current = view.current;
                if (!current) return;
                const at = Math.min(offset, current.state.doc.length);
                current.dispatch({ selection: { anchor: at }, scrollIntoView: true });
                current.focus();
            },
        }));

        useEffect(() => {
            if (!host.current) return;
            const capability = aiEditing
                ? createMarkdownAiEditor({
                      config: () => latest.current.aiEditing ?? aiEditing,
                      label: () => latest.current.t("action.custom"),
                      confirmOverlap: () => window.confirm(latest.current.t("overlap")),
                  })
                : undefined;
            const { extensions, completions } = configure?.() ?? {};
            const sources = [
                ...(completions ?? []),
                ...(capability ? [capability.completion] : []),
            ];
            let lastText = value;
            function report(text: string) {
                if (text === lastText) return;
                lastText = text;
                if (reported.current.at(-1) !== text) reported.current.push(text);
                // Acknowledgements can arrive after subsequent editor changes.
                if (reported.current.length > 100) reported.current.shift();
                latest.current.onChange(text);
            }
            reported.current = [];
            const state = EditorState.create({
                doc: value,
                extensions: [
                    history(),
                    drawSelection(),
                    indentOnInput(),
                    closeBrackets(),
                    highlightSelectionMatches(),
                    EditorView.lineWrapping,
                    markdown({ base: markdownLanguage, completeHTMLTags: false }),
                    autocompletion({ override: sources, icons: false }),
                    extensions ?? [],
                    capability?.extension ?? [],
                    keymap.of([
                        ...closeBracketsKeymap,
                        ...completionKeymap,
                        ...searchKeymap,
                        ...foldKeymap,
                        ...historyKeymap,
                        ...defaultKeymap,
                    ]),
                    markdownTheme,
                    markdownHighlight,
                    placeholder ? placeholderText(placeholder) : [],
                    contentAttributes.of(
                        EditorView.contentAttributes.of({
                            "aria-label": label,
                            spellcheck: "true",
                        }),
                    ),
                    EditorView.updateListener.of((update) => {
                        capability?.update(update);
                        if (
                            update.transactions.some((transaction) =>
                                transaction.isUserEvent("external"),
                            )
                        ) {
                            lastText = update.state.doc.toString();
                            return;
                        }
                        if (
                            update.docChanged ||
                            (capability && (update.selectionSet || update.focusChanged))
                        )
                            report(
                                capability?.savedText(update.state) ?? update.state.doc.toString(),
                            );
                    }),
                ],
            });
            const editor = new EditorView({ state, parent: host.current });
            view.current = editor;
            capability?.attach(editor);
            const pageHide = () => capability?.cancel(false);
            if (capability) window.addEventListener("pagehide", pageHide);
            // The CodeMirror instance owns the capability and is recreated with the document.
            setAi(capability);
            return () => {
                if (capability) window.removeEventListener("pagehide", pageHide);
                capability?.destroy();
                editor.destroy();
                view.current = null;
            };
            // Extensions are registered per document and read host callbacks through refs.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [docId, aiEnabled]);

        useEffect(() => {
            view.current?.dispatch({
                effects: contentAttributes.reconfigure(
                    EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
                ),
            });
        }, [contentAttributes, label]);

        useEffect(() => {
            const current = view.current;
            if (!current) return;
            const own = reported.current.lastIndexOf(value);
            if (own >= 0) {
                reported.current.splice(0, own + 1);
                return;
            }
            const text = current.state.doc.toString();
            if (text !== value) {
                ai?.cancel(false);
                current.dispatch({
                    changes: { from: 0, to: text.length, insert: value },
                    annotations: [
                        Transaction.userEvent.of("external"),
                        Transaction.addToHistory.of(false),
                    ],
                });
            }
            // Only a changed host value is an external document update.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [value]);

        return (
            <div className="flex h-full min-h-0 flex-col">
                {aiEnabled && ai && <MarkdownAiControls key={docId} editor={ai} />}
                <div ref={host} className="min-h-0 flex-1" />
            </div>
        );
    },
);
