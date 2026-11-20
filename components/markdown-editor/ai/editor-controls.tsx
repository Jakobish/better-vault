import { useEffect, useMemo, useRef, useSyncExternalStore, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/panelui/button";
import { ModelPicker } from "@/components/panelui/model-picker";
import { Textarea } from "@/components/panelui/textarea";
import { ProviderIcon } from "@/components/provider-icon";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { modelKey } from "@/lib/ai/catalog";
import { availableModels, providerName, useSettings } from "@/lib/db/settings";
import { maxInstruction, type MarkdownAiAction } from "@/lib/markdown/ai/request";
import type { MarkdownAiEditor } from "./editor";
import { editingContext, editingModel, useEditRequest } from "./use-edit-request";

const surface = "rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg";
const row = "flex flex-wrap items-center gap-1";
const chip = "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground";

export function MarkdownAiControls({ editor }: { editor: MarkdownAiEditor }) {
    const { t } = useTranslation("markdownEditor", { keyPrefix: "ai" });
    const state = useSyncExternalStore(editor.subscribe, editor.snapshot);
    const { generate, override, setOverride, feedback, partial } = useEditRequest(
        editor,
        state.sessionId,
    );
    const settings = useSettings();
    const model = settings ? editingModel(settings, override) : null;
    const models = settings ? availableModels(settings) : [];
    const working = state.status === "generating" || state.status === "streaming";
    const prompting = state.status === "prompting";
    const reviewing = state.status === "reviewing";
    const custom = state.operation === "custom" || state.operation === "refine";
    const [hasReview, hasChanges] = [state.proposal !== undefined, state.hunks.length > 0];
    const context = useMemo(() => {
        if (!prompting || !settings || !model) return null;
        const request = editor.requestData();
        return request && editingContext(settings, model, request);
        // The editor publishes a new snapshot when the target or instruction changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, settings, model?.provider, model?.modelId, state, prompting]);

    function start(action: MarkdownAiAction, fresh = true) {
        focusPanel.current = true;
        if (editor.start(action)) void generate(false, fresh ? null : override);
    }

    const panelRef = useRef<HTMLElement>(null);
    const focusPanel = useRef(false);
    function rememberPanelFocus() {
        focusPanel.current = true;
    }
    function forgetPanelFocus(event: FocusEvent<HTMLElement>) {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
            focusPanel.current = false;
    }
    const panelPhase = state.status === "streaming" ? "generating" : state.status;
    useEffect(() => {
        if ((!focusPanel.current && panelPhase !== "prompting") || panelPhase === "idle") return;
        panelRef.current?.querySelector<HTMLElement>("textarea, button:not([disabled])")?.focus();
    }, [panelPhase]);

    const menu = editor.menuElement();
    const panel = state.status !== "idle" && state.status !== "committing";
    const documentKind = editor.documentKind();
    const scopeLabel = (scope: NonNullable<typeof state.scope>) =>
        scope === "whole" ? t(`documentKind.${documentKind}.whole`) : t(`scope.${scope}`);
    const scopeHint = (scope: NonNullable<typeof state.scope>) =>
        scope === "whole" ? t(`documentKind.${documentKind}.wholeHint`) : t(`scopeHint.${scope}`);
    const nearby = prompting && model ? context?.partial || context === null : partial;
    const contextChips = state.scope && (
        <div className={row}>
            <span
                className={chip}
                title={scopeHint(state.scope)}
                aria-label={scopeHint(state.scope)}
            >
                {scopeLabel(state.scope)}
            </span>
            <span
                className={chip}
                title={t(nearby ? "nearbyHint" : `documentKind.${documentKind}.contextHint`)}
                aria-label={t(nearby ? "nearbyHint" : `documentKind.${documentKind}.contextHint`)}
            >
                {t(nearby ? "nearby" : `documentKind.${documentKind}.context`)}
            </span>
        </div>
    );
    const status =
        state.announcement === "completed"
            ? t("hunkCount", { count: state.hunks.length })
            : state.announcement
              ? state.decisionLine &&
                (state.announcement === "accept" || state.announcement === "reject")
                  ? t(`status.${state.announcement}Line`, { line: state.decisionLine })
                  : t(`status.${state.announcement}`)
              : "";

    return (
        <>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {status} {panel && (feedback.error || feedback.notice)}
            </div>
            {state.selectionMenu &&
                menu &&
                createPortal(
                    <div
                        className={`${surface} ${row} max-w-[min(25rem,80vw)]`}
                        role="group"
                        aria-label={t("selectionActions")}
                        data-markdown-ai
                        onBlur={() => queueMicrotask(editor.refresh)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                editor.cancel();
                            }
                        }}
                    >
                        {state.actions
                            .filter((action) => action !== "continue")
                            .map((action) => (
                                <Button
                                    key={action}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => start(action)}
                                >
                                    {t(`action.${action}`)}
                                </Button>
                            ))}
                    </div>,
                    menu,
                )}
            {panel && (
                <section
                    ref={panelRef}
                    className={`${surface} relative z-20 mx-2 my-1 max-w-xl shrink-0 space-y-2 sm:mx-auto sm:w-full`}
                    aria-label={t("action.custom")}
                    data-markdown-ai
                    onFocus={rememberPanelFocus}
                    onBlur={forgetPanelFocus}
                    onKeyDown={(event) => {
                        if (
                            event.key === "Escape" &&
                            !event.defaultPrevented &&
                            event.currentTarget.contains(event.target as Node)
                        ) {
                            event.stopPropagation();
                            editor.cancel();
                        }
                    }}
                >
                    {state.status === "scoping" && (
                        <>
                            <p className="text-sm font-medium">{t("chooseScope")}</p>
                            <div className={row}>
                                {state.choices.map((scope, index) => (
                                    <Button
                                        key={scope}
                                        autoFocus={index === 0}
                                        size="sm"
                                        variant="outline"
                                        onClick={() => editor.chooseScope(scope)}
                                    >
                                        {scopeLabel(scope)}
                                    </Button>
                                ))}
                                {state.choices.includes("insert") &&
                                    state.actions.includes("continue") && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => start("continue", false)}
                                        >
                                            {t("action.continue")}
                                        </Button>
                                    )}
                                <Button size="sm" variant="ghost" onClick={() => editor.cancel()}>
                                    {t("cancel")}
                                </Button>
                            </div>
                        </>
                    )}
                    {contextChips}
                    {feedback.notice && (
                        <p className="text-sm text-muted-foreground">{feedback.notice}</p>
                    )}
                    {prompting && (
                        <>
                            {custom && (
                                <Textarea
                                    maxLength={maxInstruction}
                                    minRows={2}
                                    maxRows={5}
                                    value={state.instruction}
                                    aria-label={t("instruction")}
                                    placeholder={t("instruction")}
                                    dir="auto"
                                    onChange={(event) => editor.instruct(event.target.value)}
                                />
                            )}
                            {!model && settings && !feedback.error && (
                                <p className="text-sm text-muted-foreground">{t("noModel")}</p>
                            )}
                            {feedback.error && (
                                <p className="text-sm text-destructive">{feedback.error}</p>
                            )}
                            {model && !context && !feedback.error && (
                                <p className="text-sm text-destructive">{t("tooLarge")}</p>
                            )}
                            <div className={row}>
                                {model ? (
                                    <ModelPicker
                                        variant="rail"
                                        label={t("model")}
                                        value={modelKey(model)}
                                        onValueChange={setOverride}
                                        items={models.map((ref) => ({
                                            value: modelKey(ref),
                                            label: ref.modelId,
                                            provider: ref.provider,
                                        }))}
                                        providers={[
                                            ...new Set(models.map((ref) => ref.provider)),
                                        ].map((id) => ({
                                            value: id,
                                            label: providerName(settings, id),
                                            icon: <ProviderIcon provider={id} size={20} />,
                                        }))}
                                    >
                                        <ModelPicker.Trigger
                                            appearance="ghost"
                                            className="max-w-56"
                                            placeholder={t("model")}
                                        />
                                        <ModelPicker.Content
                                            side="bottom"
                                            placeholder={t("searchModels")}
                                            emptyText={t("noModel")}
                                        />
                                    </ModelPicker>
                                ) : (
                                    settings && (
                                        <SettingsSheet
                                            page="providers"
                                            trigger={
                                                <Button size="sm" variant="outline">
                                                    {t("settings")}
                                                </Button>
                                            }
                                        />
                                    )
                                )}
                                <Button
                                    size="sm"
                                    disabled={
                                        !model || !context || (custom && !state.instruction.trim())
                                    }
                                    onClick={() => void generate()}
                                >
                                    {t("generate")}
                                </Button>
                                {state.attempted && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!model}
                                        onClick={() => void generate(true)}
                                    >
                                        {t("retry")}
                                    </Button>
                                )}
                                {hasReview && (
                                    <Button size="sm" variant="ghost" onClick={editor.resumeReview}>
                                        {t("review")}
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => editor.cancel()}>
                                    {t("cancel")}
                                </Button>
                            </div>
                        </>
                    )}
                    {working && (
                        <div className={row}>
                            <span className="me-auto text-sm text-muted-foreground">
                                {t("status.started")}
                            </span>
                            {model && <span className={chip}>{model.modelId}</span>}
                            <Button size="sm" variant="outline" onClick={editor.stop}>
                                {t("stop")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => editor.cancel()}>
                                {t("cancel")}
                            </Button>
                        </div>
                    )}
                    {reviewing && (
                        <>
                            <p className="text-sm text-muted-foreground">
                                {t("hunkCount", { count: state.hunks.length })}
                            </p>
                            <div className={row}>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!hasChanges}
                                    onClick={() => editor.decide("accept")}
                                >
                                    {t("acceptAll")}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!hasChanges}
                                    onClick={() => editor.decide("reject")}
                                >
                                    {t("rejectAll")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={editor.refine}>
                                    {t("refine")}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void generate(true)}
                                >
                                    {t("retry")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => editor.cancel()}>
                                    {t("cancel")}
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={
                                        !hasChanges || state.hunks.some(({ decision }) => !decision)
                                    }
                                    onClick={editor.commit}
                                >
                                    {t("done")}
                                </Button>
                            </div>
                        </>
                    )}
                </section>
            )}
            {working &&
                state.previewElement &&
                createPortal(
                    <div className="mx-auto my-2 max-w-[43rem] space-y-2 rounded-lg border bg-muted p-3">
                        <div className={row}>
                            <span className="me-auto text-sm font-medium">{t("preview")}</span>
                            <Button size="sm" variant="outline" onClick={editor.stop}>
                                {t("stop")}
                            </Button>
                        </div>
                        <div className="text-sm wrap-anywhere whitespace-pre-wrap" dir="auto">
                            {state.preview}
                        </div>
                    </div>,
                    state.previewElement,
                )}
            {state.hunks.map((hunk) =>
                createPortal(
                    <div
                        className="mx-auto my-2 max-w-[43rem] space-y-1 rounded-lg border bg-card p-2 text-sm"
                        role="group"
                        aria-label={t("changeAt", { line: hunk.line })}
                    >
                        {hunk.removed && (
                            <div
                                className="rounded bg-destructive/10 px-2 py-1 wrap-anywhere whitespace-pre-wrap line-through"
                                dir="auto"
                                aria-label={t("removed")}
                            >
                                {hunk.removed}
                            </div>
                        )}
                        {hunk.added && (
                            <div
                                className="rounded bg-success/15 px-2 py-1 wrap-anywhere whitespace-pre-wrap"
                                dir="auto"
                                aria-label={t("added")}
                            >
                                {hunk.added}
                            </div>
                        )}
                        <div className={row}>
                            <span className="me-auto text-xs text-muted-foreground">
                                {t("changeAt", { line: hunk.line })}
                            </span>
                            <Button
                                size="sm"
                                variant={hunk.decision === "accept" ? "default" : "outline"}
                                aria-pressed={hunk.decision === "accept"}
                                disabled={!reviewing}
                                aria-label={t("acceptAt", { line: hunk.line })}
                                onClick={() => editor.decide("accept", hunk.id)}
                            >
                                {t("accept")}
                            </Button>
                            <Button
                                size="sm"
                                variant={hunk.decision === "reject" ? "default" : "outline"}
                                aria-pressed={hunk.decision === "reject"}
                                disabled={!reviewing}
                                aria-label={t("rejectAt", { line: hunk.line })}
                                onClick={() => editor.decide("reject", hunk.id)}
                            >
                                {t("reject")}
                            </Button>
                        </div>
                    </div>,
                    hunk.element,
                    hunk.id,
                ),
            )}
        </>
    );
}
