import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { linkCompletion, tagCompletion, type CompletionWorld } from "./completion";
import { notesKeymap } from "./keymap";
import { livePreview, type LivePreviewOptions } from "./live-preview";

export function noteMarkdownExtensions(
    links: LivePreviewOptions & { world: () => CompletionWorld },
) {
    return {
        extensions: [livePreview(links), Prec.high(keymap.of(notesKeymap(links.open)))],
        completions: [linkCompletion(links.world), tagCompletion(links.world)],
    };
}
