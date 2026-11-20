import { generateId } from "ai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { modelKey, type ModelRef } from "@/lib/ai/catalog";
import {
    activeModel,
    availableModels,
    contextCharsFor,
    contextTokensFor,
    credentialsFor,
    effortFor,
    getSettings,
    type AppSettings,
} from "@/lib/db/settings";
import { budgetContext } from "@/lib/markdown/ai/context";
import { maxTarget } from "@/lib/markdown/ai/request";
import type { EditRequest, MarkdownAiEditor } from "./editor";

export function editingModel(settings: AppSettings, override: string | null) {
    return (
        availableModels(settings).find((model) => modelKey(model) === override) ??
        activeModel(settings)
    );
}

export function editingContext(settings: AppSettings, model: ModelRef, request: EditRequest) {
    const limit = Math.min(
        contextCharsFor(settings, model.provider),
        contextTokensFor(settings, model) * 4,
    );
    // Leave room for the system prompt, output, instruction and the prior draft.
    const reserve =
        1500 +
        Math.floor(limit * 0.25) +
        request.document.title.length +
        JSON.stringify(request.instruction ?? "").length +
        JSON.stringify(request.previous ?? "").length;
    return budgetContext(request.markdown, request.target, limit - reserve);
}

const emptyFeedback = { error: "", notice: "" };

export function useEditRequest(editor: MarkdownAiEditor, sessionId: number) {
    const { t } = useTranslation("markdownEditor", { keyPrefix: "ai" });
    const [selection, setSelection] = useState<{ id: number; key: string }>();
    const [message, setMessage] = useState<{ id: number; error: string; notice: string }>();
    const [context, setContext] = useState<{ id: number; partial: boolean }>();
    const override = selection?.id === sessionId ? selection.key : null;
    const feedback = message?.id === sessionId ? message : emptyFeedback;
    const partial = context?.id === sessionId && context.partial;
    const setOverride = (key: string) => setSelection({ id: sessionId, key });

    async function generate(retry = false, chosen = override) {
        const running = editor.begin(retry);
        if (!running) return;
        const { request, signal } = running;
        const id = editor.snapshot().sessionId;
        const setFeedback = (feedback: typeof emptyFeedback) => setMessage({ id, ...feedback });
        setFeedback(emptyFeedback);
        let notice = "";
        function fail(error: string) {
            if (signal.aborted) return;
            setFeedback({ error, notice });
            editor.fail(signal);
        }
        try {
            const settings = await getSettings();
            if (signal.aborted) return;
            const model = editingModel(settings, chosen);
            if (!model) return fail(t("noModel"));
            if (chosen && modelKey(model) !== chosen) {
                notice = t("fallback");
                setSelection({ id, key: modelKey(model) });
                setFeedback({ error: "", notice });
            }
            if (
                ["rewrite", "shorten", "expand", "summarize"].includes(request.operation) &&
                !request.original.trim()
            )
                return fail(t("emptyTarget"));
            const context = editingContext(settings, model, request);
            if (!context) return fail(t("tooLarge"));
            setContext({ id, partial: context.partial });
            // Let the updated scope and any model fallback render before sending.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) return;
            const deletionMarker = `BETTER_VAULT_DELETE_${generateId()}`;
            const response = await fetch("/api/markdown/edit", {
                method: "POST",
                signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...request,
                    ...context,
                    model,
                    deletionMarker,
                    document: { ...request.document, title: request.document.title.slice(0, 500) },
                    credentials: credentialsFor(settings, model.provider),
                    effort: effortFor(settings, model.provider),
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                return fail(
                    typeof body?.error === "string"
                        ? t("providerError", { error: body.error })
                        : t("failed"),
                );
            }
            if (!response.body) return fail(t("failed"));
            let result = "";
            let shown = 0;
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (signal.aborted || done) break;
                    result += value;
                    if (result.length > maxTarget) {
                        void reader.cancel().catch(() => {});
                        return fail(t("tooLarge"));
                    }
                    // Hold back a possible deletion marker so it never appears as prose.
                    const trimmed = result.trim();
                    if (deletionMarker.startsWith(trimmed) || trimmed === deletionMarker) continue;
                    editor.chunk(signal, result.slice(shown));
                    shown = result.length;
                }
            } finally {
                reader.releaseLock();
            }
            if (signal.aborted) return;
            if (!result.trim()) return fail(t("emptyResult"));
            editor.complete(
                signal,
                result.trim() === deletionMarker ? "" : result.replace(/\r\n?/g, "\n"),
            );
        } catch {
            fail(t("failed"));
        }
    }

    return { override, setOverride, feedback, partial, generate };
}
