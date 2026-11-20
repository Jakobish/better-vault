import type { CompletionSource } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import {
    EditorSelection,
    StateEffect,
    StateField,
    Transaction,
    EditorState,
} from "@codemirror/state";
import {
    Decoration,
    EditorView,
    showTooltip,
    tooltips,
    WidgetType,
    type Tooltip,
    type ViewUpdate,
} from "@codemirror/view";
import { scopeTarget } from "@/lib/markdown/ai/context";
import {
    actions,
    scopes,
    type MarkdownAiAction,
    type MarkdownAiScope,
    type MarkdownEditRequest,
    type Target,
} from "@/lib/markdown/ai/request";
import { acceptedChanges, reviewHunks, type Hunk } from "@/lib/markdown/ai/review";

export interface MarkdownAiEditingConfig {
    documentKind: MarkdownEditRequest["document"]["kind"];
    getContext: () => { title: string };
    actions?: readonly MarkdownAiAction[];
    scopes?: readonly MarkdownAiScope[];
}

type Scope = MarkdownAiScope | "selection";
type Operation = MarkdownEditRequest["operation"];
export type EditRequest = Pick<
    MarkdownEditRequest,
    "document" | "operation" | "instruction" | "previous" | "original" | "target" | "markdown"
>;
type Status =
    "idle" | "scoping" | "prompting" | "generating" | "streaming" | "reviewing" | "committing";
type Decision = NonNullable<Hunk["decision"]>;
export type Announcement =
    "started" | "stopped" | "completed" | "cancelled" | "committed" | Decision;

interface ReviewHunk extends Hunk {
    element: HTMLElement;
    line: number;
}

interface Snapshot {
    status: Status;
    sessionId: number;
    actions: readonly MarkdownAiAction[];
    choices: readonly MarkdownAiScope[];
    selectionMenu: boolean;
    scope?: Scope;
    operation?: Operation;
    instruction: string;
    preview: string;
    proposal?: string;
    previewElement?: HTMLElement;
    hunks: ReviewHunk[];
    attempted: boolean;
    announcement?: Announcement;
    decisionLine?: number;
}

const initial: Snapshot = {
    status: "idle",
    sessionId: 0,
    actions: [],
    choices: [],
    selectionMenu: false,
    instruction: "",
    preview: "",
    hunks: [],
    attempted: false,
};
const cancelEffect = StateEffect.define<null>();
const widgetsEffect = StateEffect.define<{
    tooltip: Tooltip | null;
    blocks: ReturnType<typeof Decoration.set>;
}>();
const aiCommit = Transaction.userEvent.of("input.ai");

class PortalWidget extends WidgetType {
    constructor(readonly element: HTMLElement) {
        super();
    }
    eq(other: PortalWidget) {
        return this.element === other.element;
    }
    toDOM() {
        return this.element;
    }
}

function slashPrefix(state: EditorState) {
    const selection = state.selection.main;
    if (!selection.empty) return null;
    const line = state.doc.lineAt(selection.head);
    const match = line.text.slice(0, selection.head - line.from).match(/(?:^|\s)(\/a?i?)$/);
    if (
        !match ||
        !["/", "/a", "/ai"].includes(match[1]) ||
        /\S/.test(line.text.charAt(selection.head - line.from))
    )
        return null;
    return { from: selection.head - match[1].length, to: selection.head };
}

export function createMarkdownAiEditor(options: {
    config: () => MarkdownAiEditingConfig;
    label: () => string;
    confirmOverlap: () => boolean;
}) {
    let view: EditorView | undefined;
    let snapshot = initial;
    let sessionId = 0;
    let target: Target | undefined;
    let controller: AbortController | undefined;
    let last: Pick<EditRequest, "operation" | "instruction" | "previous"> | undefined;
    let slashDraft = false;
    let dismissedSelection = false;
    const listeners = new Set<() => void>();
    function publish(next: Snapshot) {
        snapshot = next;
        listeners.forEach((listener) => listener());
    }

    const tooltipElement = () => {
        const element = view!.dom.ownerDocument.createElement("div");
        element.className = "bv-ai-selection";
        return element;
    };
    let menuElement: HTMLElement | undefined;
    const createMenu = (editor: EditorView) => ({
        dom: (menuElement ??= tooltipElement()),
        offset: { x: 0, y: 5 },
        getCoords(pos: number) {
            const start = editor.coordsAtPos(pos, 1);
            const end = editor.coordsAtPos(editor.state.selection.main.to, -1);
            return start && end
                ? { ...start, bottom: end.bottom }
                : (start ?? end ?? editor.scrollDOM.getBoundingClientRect());
        },
    });

    const visuals = StateField.define<{
        tooltip: Tooltip | null;
        blocks: ReturnType<typeof Decoration.set>;
    }>({
        create: () => ({ tooltip: null, blocks: Decoration.none }),
        update(value, transaction) {
            if (transaction.effects.some((effect) => effect.is(cancelEffect)))
                return { tooltip: null, blocks: Decoration.none };
            for (const effect of transaction.effects)
                if (effect.is(widgetsEffect)) return effect.value;
            return { ...value, blocks: value.blocks.map(transaction.changes) };
        },
        provide: (field) => [
            EditorView.decorations.from(field, (value) => value.blocks),
            showTooltip.from(field, (value) => value.tooltip),
        ],
    });

    function refresh() {
        if (!view) return;
        const allowed = options.config().actions ?? actions;
        const range = view.state.selection.main;
        const menu =
            snapshot.status === "idle" &&
            !range.empty &&
            view.state.selection.ranges.length === 1 &&
            !dismissedSelection &&
            (view.hasFocus || Boolean(menuElement?.contains(view.dom.ownerDocument.activeElement)));
        const tooltip: Tooltip | null = menu
            ? {
                  pos: range.from,
                  end: range.to,
                  above: true,
                  create: createMenu,
              }
            : null;
        const blocks = [];
        const doc = view.state.doc;
        const at = (offset: number) => doc.lineAt(offset).from;
        if (
            target &&
            snapshot.previewElement &&
            ((snapshot.status === "generating" && snapshot.proposal === undefined) ||
                snapshot.status === "streaming")
        ) {
            blocks.push(
                Decoration.widget({
                    widget: new PortalWidget(snapshot.previewElement),
                    block: true,
                    side: -1,
                }).range(at(target.from)),
            );
        } else if (target) {
            for (const hunk of snapshot.hunks) {
                blocks.push(
                    Decoration.widget({
                        widget: new PortalWidget(hunk.element),
                        block: true,
                        side: -1,
                    }).range(at(target.from + hunk.from)),
                );
                if (hunk.removed)
                    blocks.push(
                        Decoration.mark({ class: "bg-destructive/10 line-through" }).range(
                            target.from + hunk.from,
                            target.from + hunk.to,
                        ),
                    );
            }
        }
        const current = view.state.field(visuals);
        if (current.tooltip || tooltip || current.blocks.size || blocks.length) {
            view.dispatch({
                effects: widgetsEffect.of({ tooltip, blocks: Decoration.set(blocks, true) }),
            });
        }
        publish({ ...snapshot, actions: allowed, selectionMenu: menu });
    }

    function cancel(focus = true, update = true) {
        controller?.abort();
        controller = undefined;
        const previousTarget = target;
        target = undefined;
        last = undefined;
        dismissedSelection = true;
        publish({ ...initial, announcement: "cancelled" });
        if (focus && view) {
            if (previousTarget)
                view.dispatch({
                    selection: EditorSelection.single(previousTarget.from, previousTarget.to),
                    scrollIntoView: true,
                });
            dismissedSelection = true;
            view.focus();
        }
        if (update) refresh();
    }

    function start(action: MarkdownAiAction) {
        if (!view || !(options.config().actions ?? actions).includes(action)) return false;
        const sameSession = snapshot.status === "scoping" && action === "continue";
        if (snapshot.status !== "idle" && !sameSession) cancel(false);
        if (action === "continue" && !(options.config().scopes ?? scopes).includes("insert"))
            return false;
        const range = view.state.selection.main;
        const selected = !range.empty && action !== "continue";
        target = selected
            ? { from: range.from, to: range.to }
            : { from: range.head, to: range.head };
        const allowed = options.config().scopes ?? scopes;
        const choices =
            selected || action === "continue"
                ? []
                : allowed.filter((scope) =>
                      scopeTarget(view!.state.doc.toString(), range.head, scope),
                  );
        publish({
            ...initial,
            sessionId: sameSession ? snapshot.sessionId : ++sessionId,
            status: selected || action === "continue" ? "prompting" : "scoping",
            operation: action,
            scope: selected ? "selection" : action === "continue" ? "insert" : undefined,
            choices,
        });
        refresh();
        return (selected && action !== "custom") || action === "continue";
    }

    function chooseScope(scope: MarkdownAiScope) {
        if (!view || !target || snapshot.status !== "scoping" || !snapshot.choices.includes(scope))
            return;
        const next = scopeTarget(view.state.doc.toString(), target.from, scope);
        if (!next) return;
        target = next;
        publish({ ...snapshot, scope, status: "prompting" });
        refresh();
    }

    function requestData(): EditRequest | null {
        if (!view || !target || !snapshot.operation || !snapshot.scope) return null;
        const markdown = view.state.doc.toString();
        return {
            target: { ...target },
            markdown,
            original: markdown.slice(target.from, target.to),
            operation: snapshot.operation,
            instruction: snapshot.instruction,
            previous: snapshot.operation === "refine" ? snapshot.proposal : undefined,
            document: {
                kind: options.config().documentKind,
                title: options.config().getContext().title,
            },
        };
    }

    function begin(retry = false) {
        if (!view || !["prompting", "reviewing"].includes(snapshot.status)) return;
        const data = requestData();
        if (!data || (retry && !last)) return;
        const request = { ...data, ...(retry ? last : undefined) };
        controller?.abort();
        controller = new AbortController();
        last = {
            operation: request.operation,
            instruction: request.instruction,
            previous: request.previous,
        };
        publish({
            ...snapshot,
            ...last,
            status: "generating",
            preview: "",
            attempted: true,
            hunks: snapshot.hunks.map((hunk) => ({ ...hunk, decision: undefined })),
            previewElement: view.dom.ownerDocument.createElement("div"),
            announcement: "started",
        });
        refresh();
        return { request, signal: controller.signal };
    }

    function stopped(signal?: AbortSignal, announcement?: Announcement) {
        if (!controller || (signal && controller.signal !== signal)) return;
        controller.abort();
        controller = undefined;
        publish({
            ...snapshot,
            status: "prompting",
            preview: "",
            previewElement: undefined,
            announcement,
        });
        refresh();
    }

    function chunk(signal: AbortSignal, text: string) {
        if (!text || controller?.signal !== signal || signal.aborted) return;
        const first = snapshot.status === "generating";
        publish({ ...snapshot, status: "streaming", preview: snapshot.preview + text });
        if (first) refresh();
    }

    function complete(signal: AbortSignal, proposal: string) {
        if (!view || !target || controller?.signal !== signal || signal.aborted) return;
        controller = undefined;
        const doc = view.state.doc;
        const hunks = reviewHunks(doc.sliceString(target.from, target.to), proposal).map(
            (hunk) => ({
                ...hunk,
                line: doc.lineAt(target!.from + hunk.from).number,
                element: view!.dom.ownerDocument.createElement("div"),
            }),
        );
        publish({
            ...snapshot,
            hunks,
            status: "reviewing",
            proposal,
            previewElement: undefined,
            preview: "",
            announcement: "completed",
        });
        refresh();
    }

    function decide(decision: Decision, id?: string) {
        if (snapshot.status !== "reviewing") return;
        publish({
            ...snapshot,
            hunks: snapshot.hunks.map((hunk) =>
                !id || hunk.id === id ? { ...hunk, decision } : hunk,
            ),
            announcement: decision,
            decisionLine: id ? snapshot.hunks.find((hunk) => hunk.id === id)?.line : undefined,
        });
    }

    function refine() {
        if (snapshot.status !== "reviewing") return;
        publish({ ...snapshot, status: "prompting", operation: "refine", announcement: undefined });
    }

    function commit() {
        if (
            !view ||
            !target ||
            snapshot.status !== "reviewing" ||
            snapshot.hunks.some((hunk) => !hunk.decision)
        )
            return;
        const changes = acceptedChanges(target, snapshot.hunks);
        if (!changes.length) {
            cancel();
            return;
        }
        const first = changes[0];
        const selection = EditorSelection.single(
            first.from,
            first.from + first.insert.replace(/\r\n?/g, "\n").length,
        );
        publish({ ...snapshot, status: "committing" });
        view.dispatch({
            changes,
            selection,
            effects: [cancelEffect.of(null), EditorView.scrollIntoView(selection.main.from)],
            annotations: [aiCommit, isolateHistory.of("full")],
        });
        publish({ ...initial, announcement: "committed" });
        dismissedSelection = true;
        view.focus();
    }

    const completion: CompletionSource = (context) => {
        if (snapshot.status !== "idle" || !(options.config().actions ?? actions).includes("custom"))
            return null;
        const prefix = slashPrefix(context.state);
        if (!prefix || prefix.to !== context.pos || prefix.to - prefix.from < 2) return null;
        return {
            from: prefix.from,
            options: [
                {
                    label: "/ai",
                    displayLabel: options.label(),
                    apply(editor, _completion, from, to) {
                        editor.dispatch({
                            changes: { from, to },
                            selection: { anchor: from },
                            annotations: [
                                Transaction.addToHistory.of(false),
                                Transaction.userEvent.of("input.ai-trigger"),
                            ],
                        });
                        start("custom");
                    },
                },
            ],
        };
    };

    const extension = [
        visuals,
        tooltips({
            tooltipSpace(editor) {
                const rect = editor.scrollDOM.getBoundingClientRect();
                const win = editor.dom.ownerDocument.defaultView!;
                return {
                    top: Math.max(0, rect.top),
                    left: Math.max(0, rect.left),
                    right: Math.min(win.innerWidth, rect.right),
                    bottom: Math.min(win.innerHeight, rect.bottom),
                };
            },
        }),
        EditorView.domEventHandlers({
            keydown(event) {
                if (event.key === "Tab" && snapshot.selectionMenu && !event.shiftKey) {
                    menuElement?.querySelector("button")?.focus();
                    return true;
                }
                if (event.key === "Escape" && snapshot.selectionMenu) {
                    dismissedSelection = true;
                    refresh();
                    view?.focus();
                    return true;
                }
                return false;
            },
        }),
        // Constrain tooltip placement to the visible editor as well as the browser.
        EditorView.theme({
            ".cm-tooltip.bv-ai-selection": { background: "transparent", border: "none" },
        }),
        EditorState.transactionFilter.of((transaction) => {
            if (!target || !transaction.docChanged || transaction.isUserEvent("input.ai"))
                return transaction;
            if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo"))
                return [transaction, { effects: cancelEffect.of(null) }];
            let overlaps = false;
            const { from, to } = target;
            transaction.changes.iterChangedRanges((start, end) => {
                overlaps ||=
                    from === to
                        ? start <= from && end >= to
                        : start === end
                          ? start > from && start < to
                          : start < to && end > from;
            });
            if (!overlaps) return transaction;
            return options.confirmOverlap()
                ? [transaction, { effects: cancelEffect.of(null) }]
                : [];
        }),
    ];

    function update(update: ViewUpdate) {
        const cancelled = update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(cancelEffect)),
        );
        if (cancelled) cancel(false, false);
        else if (target && update.docChanged) {
            const from = update.changes.mapPos(target.from, 1);
            target = {
                from,
                to: update.changes.mapPos(target.to, target.from === target.to ? 1 : -1),
            };
            const doc = update.state.doc;
            publish({
                ...snapshot,
                hunks: snapshot.hunks.map((hunk) => ({
                    ...hunk,
                    line: doc.lineAt(from + hunk.from).number,
                })),
            });
        }
        if (update.docChanged) {
            const prefix = slashPrefix(update.state);
            slashDraft = Boolean(
                prefix &&
                (options.config().actions ?? actions).includes("custom") &&
                update.transactions.some((transaction) => transaction.isUserEvent("input.type")),
            );
        } else if (update.selectionSet && !update.startState.selection.eq(update.state.selection)) {
            slashDraft = false;
        }
        if (
            update.selectionSet &&
            (!update.startState.selection.eq(update.state.selection) ||
                update.transactions.some((transaction) => transaction.isUserEvent("select")))
        )
            dismissedSelection = false;
        if (update.selectionSet || update.docChanged || update.focusChanged)
            queueMicrotask(refresh);
    }

    return {
        extension,
        completion,
        update,
        start,
        chooseScope,
        requestData,
        begin,
        chunk,
        complete,
        decide,
        refine,
        commit,
        instruct(instruction: string) {
            if (snapshot.status === "prompting") publish({ ...snapshot, instruction });
        },
        resumeReview() {
            if (snapshot.status === "prompting" && snapshot.proposal !== undefined)
                publish({ ...snapshot, status: "reviewing", announcement: "completed" });
        },
        stop: () => stopped(undefined, "stopped"),
        fail: stopped,
        cancel,
        attach(editor: EditorView) {
            view = editor;
            refresh();
        },
        destroy() {
            cancel(false, false);
            view = undefined;
            menuElement = undefined;
        },
        snapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        menuElement: () => menuElement,
        refresh,
        documentKind: () => options.config().documentKind,
        savedText(state: EditorState) {
            const prefix = slashDraft ? slashPrefix(state) : null;
            return prefix
                ? state.sliceDoc(0, prefix.from) + state.sliceDoc(prefix.to)
                : state.doc.toString();
        },
    };
}

export type MarkdownAiEditor = ReturnType<typeof createMarkdownAiEditor>;
