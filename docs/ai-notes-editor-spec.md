# AI-assisted note editing

This specification defines the first AI features in the Markdown notes editor.

The feature helps you rewrite and extend the note you are already editing. It uses only the
current note as context, shows every proposed change before it touches the note, and keeps the
accepted result in CodeMirror's normal undo history.

## Status

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| Status          | Ready for implementation                           |
| Scope           | First release                                      |
| Editor          | CodeMirror 6 Live Preview                          |
| AI transport    | Vercel AI SDK through the app's stateless API      |
| Storage changes | None                                               |
| Desktop changes | Shared API route only; desktop checks are required |

## Goals

The first release makes common writing transformations quick without turning the notes editor
into a chat interface. You can select text and run a preset action, or type a custom instruction.
When there is no selection, you choose the exact scope before a request starts.

Every request uses the app's active text model by default. You can override the model for that
request without changing the app-wide model preference. The interface always shows which note
context will be sent.

The result streams into a temporary preview. When generation finishes, the editor shows an
inline diff split into reviewable hunks. You accept or reject each hunk, then apply all accepted
hunks together as one undoable editor transaction.

## Non-goals

The first release does not search the vault, follow `[[wikilinks]]`, retrieve notebook sources,
or use provider web search. It does not edit more than one note, run unattended, keep AI
provenance, save custom actions, or retain a prompt history.

It does not add AI to the reading view, Skills editor, note title, graph, backlinks, or properties.
It does not add a dedicated notes model setting or a default keyboard shortcut.

## Actions

The selection menu shows four immediate actions and one open-ended action.

| Action    | Input                     | Result                                                                |
| --------- | ------------------------- | --------------------------------------------------------------------- |
| Rewrite   | Selected text             | Preserve the meaning and voice while improving clarity and flow.      |
| Shorten   | Selected text             | Remove repetition and reduce length without losing material claims.   |
| Expand    | Selected text             | Add useful explanation and connective detail without inventing facts. |
| Summarize | Selected text             | Replace the target with a concise summary in compatible Markdown.     |
| Ask AI    | Selection or chosen scope | Open a prompt for a one-off instruction.                              |

**Continue writing** is available from `/ai` and the no-selection scope menu. It inserts text at
the cursor, using the current note and cursor position as context. It never replaces text before
or after the cursor.

Preset actions start immediately. They do not open the prompt first. After any preset finishes,
you can refine the proposal with a custom follow-up instruction before accepting it.

## Entry points

### Selection menu

Selecting non-empty text in edit mode opens a compact menu anchored to the selection. It contains
Rewrite, Shorten, Expand, Summarize, and Ask AI. The menu closes when the selection collapses, the
editor loses focus, the note changes, or an AI session starts.

The menu must work for pointer and keyboard selections. It must not cover the selected line when
there is room above or below it, and it must remain within the editor viewport.

### Slash command

Typing `/ai` at the start of a Markdown block or after whitespace offers an **Ask AI** completion.
Choosing it removes the trigger text and opens the AI prompt. The trigger is never saved as note
content and does not create an isolated undo step.

The slash command is deliberately discoverable through CodeMirror completion. The first release
does not register a keyboard shortcut.

### No-selection scope

If Ask AI starts without selected text, a compact menu appears before the prompt.

| Scope            | Target                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Current block    | The Markdown syntax block containing the cursor.                                                 |
| Current section  | The nearest heading and its content, ending before the next heading of the same or higher level. |
| Whole note       | The complete note body.                                                                          |
| Insert at cursor | An empty range at the cursor; generated text is inserted there.                                  |

If no heading contains the cursor, **Current section** runs from the start of the note to the first
heading after the cursor. Empty notes offer only Insert at cursor and Whole note.

## Prompt surface

Ask AI opens a compact editor-owned popover. It contains the instruction field, context chips,
the active model, a model override, and Generate or Stop according to state.

The context chips say **Selection** and **Current note** for selected text. They show the chosen
scope and **Current note** for a no-selection request. Each chip has translated explanatory text
that states what will be sent to the configured model provider.

The model control starts with `activeModel(settings)`. Its override applies only to the current
AI session, including refinements and retries, and does not call `updateSettings`. If the selected
model becomes unavailable before a request, the interface falls back to the current active model
and tells the user. If no model is available, it opens the existing AI provider settings path.

The prompt is not stored after the session ends. Closing the popover before generation discards it.

## Context and prompts

Each request contains the note title, complete note body when it fits, the target offsets, the
original target text, the action or custom instruction, and the requested operation. The prompt
marks the target with unambiguous delimiters and tells the model to return only replacement text.

The server prompt requires the model to preserve Markdown, `[[wikilinks]]`, URLs, code, citations,
frontmatter, and factual claims unless the instruction explicitly asks to change them. It must
write in the language of the target, or the note when the target is empty. It must not wrap the
answer in a code fence or explain the edit.

The client reserves room for instructions and output using `contextCharsFor`. When the full note
does not fit, it sends the target plus the largest surrounding slice that fits, aligned to Markdown
block boundaries. In that case the context chip changes from **Current note** to **Nearby context**
before the request starts. The target itself is never silently truncated. If the target cannot fit,
the request is refused with a translated message suggesting a smaller scope or a larger-context
model.

No note content, instruction, or result is written to the app's database apart from an accepted
editor change. Provider credentials follow the existing request-body rules. Errors produced before
streaming pass through `describeError`; failures after streaming starts use a translated generic
message, so a key can never be echoed.

## Review flow

### Streaming preview

The original text stays in the document while the model is running. A temporary block widget near
the target streams the proposed replacement and offers Stop. The widget is presentation state,
not document content, so autosave and Markdown analysis never see partial output.

Stopping keeps the original note unchanged and removes the partial preview. A failed request keeps
the instruction available for retry and shows a translated error without exposing credentials.

### Inline diff

After the stream completes, the editor compares the original target with the complete proposal.
Unchanged text remains ordinary editor content. Each changed hunk shows its removed and added text
in place with Accept and Reject controls. Word-level marks may clarify changes inside a changed
line, but the decision applies to the complete hunk.

Hunks begin undecided. The review toolbar provides Accept all, Reject all, Refine, Cancel, and Done.
Done remains disabled until every hunk is accepted or rejected. Rejecting all hunks and choosing
Done is equivalent to Cancel.

For insertion, the proposal is one or more addition hunks at the empty target. For deletion, the
proposal contains removal hunks with empty replacements.

The diff implementation should use a maintained text-diff package rather than a new handwritten
algorithm. Group adjacent changed lines into stable hunks, retain enough unchanged context to
orient the reader, and assign hunk ids from their original and proposed ranges rather than array
positions.

### Refinement

Refine opens the same prompt with the previous instruction available. The next request contains
the original target, the current complete proposal, and the follow-up instruction. It asks for a
new complete replacement, not a patch.

Starting refinement clears all staged hunk decisions. The old proposal remains visible until the
new stream produces its first text, so a failed refinement can restore the previous review. A
successful refinement replaces the old proposal and calculates a fresh set of hunks against the
same original target.

Retry repeats the last request. It also resets hunk decisions and keeps the original target.

### Commit and undo

Done builds one replacement from the accepted proposed hunks and the rejected original hunks. The
CodeMirror integration applies it in one transaction annotated as user input, restores a sensible
selection, scrolls the first accepted change into view, and closes the session.

The existing update listener reports the committed document once, so the normal 400 ms note save
runs unchanged. One normal Undo restores the document to its state before Done. Accepted AI text
has no permanent marker or separate history record.

## Concurrent editing

An AI session owns one target range. CodeMirror maps that range through transactions outside the
target, so you may continue editing elsewhere in the note while generation or review is open.

An edit that overlaps the target invalidates the session. Before applying that edit, the interface
warns that the AI preview will be cancelled. Confirming removes the preview and permits the edit;
cancelling the warning keeps the target and preview unchanged. Undo, redo, external note-body
replacement, switching notes, switching to reading mode, and closing the tab cancel the session.

Only one AI session may be active in an editor. Starting another action first cancels or resolves
the current session; it never queues requests.

## Interaction states

The feature has one explicit state machine.

| State      | Allowed transitions                                                                         |
| ---------- | ------------------------------------------------------------------------------------------- |
| Idle       | Choose action or `/ai` -> Scoping, Prompting, or Generating                                 |
| Scoping    | Choose scope -> Prompting; dismiss -> Idle                                                  |
| Prompting  | Generate -> Generating; dismiss -> Idle                                                     |
| Generating | First text -> Streaming; stop or fail -> Prompting; cancel -> Idle                          |
| Streaming  | Complete -> Reviewing; stop -> Prompting; fail -> Prompting                                 |
| Reviewing  | Decide hunk -> Reviewing; refine or retry -> Generating; Done -> Committing; cancel -> Idle |
| Committing | Successful transaction -> Idle; conflict -> Reviewing or Idle after confirmation            |

The request id guards every streamed update. Late chunks from an aborted or superseded request are
ignored. An `AbortController` is created per generation and aborted on Stop, Cancel, note switch,
editor destruction, and refinement.

## Module design

The CodeMirror AI integration is one deep module. Its interface exposes high-level editor commands
and observable session state; its implementation owns offsets, `ChangeDesc` mapping, decorations,
widgets, hunk decisions, conflict detection, and commit transactions. React callers never store or
transform CodeMirror positions.

```ts
interface NoteAiEditor {
    start(action: NoteAiAction): NoteAiTarget;
    startAt(target: NoteAiTarget): void;
    showStream(requestId: string, text: string): void;
    showReview(requestId: string, replacement: string): void;
    decide(hunkId: string, decision: "accept" | "reject"): void;
    commit(): void;
    cancel(): void;
    subscribe(listener: (state: NoteAiEditorState) => void): () => void;
}
```

This is a behavioral sketch, not a requirement to export these exact method names. The final
interface should remain small and should make invalid commands no-ops or typed errors. Tests and
callers use the same interface.

The implementation should be divided by responsibility without exposing extra seams:

| Module                        | Responsibility                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `components/notes/editor/ai/` | Deep CodeMirror module, selection menu anchor, decorations, widgets, target mapping, review and commit.        |
| `components/notes/ai/`        | React prompt, scope menu, context chips, model picker and request orchestration.                               |
| `lib/notes/ai/`               | Shared request types, scope extraction, context budgeting, prompt construction and pure diff/review functions. |
| `server/routes/note-edit.ts`  | Validate the request, create the configured language model and return a plain text stream.                     |

The React orchestration module accepts the editor interface, not an `EditorView`. It reads settings
fresh for each request, resolves the active or overridden model, sends credentials and effort, and
passes stream updates back to the editor module.

Scope extraction and diff assembly are in-process pure computation. They need no adapter. The
provider is a true external dependency at the server seam; route tests mock `createLanguageModel`
or the resulting language model while exercising the route's real validation and streaming shape.

## API route

Add `POST /api/notes/edit` to `server/app.ts`. The request is stateless and uses the same model,
credentials, and effort schemas as chat.

```ts
const noteEditRequest = z.object({
    model: modelRefSchema,
    credentials: credentialsSchema,
    effort: effortSchema,
    operation: z.enum([
        "rewrite",
        "shorten",
        "expand",
        "summarize",
        "continue",
        "custom",
        "refine",
    ]),
    instruction: z.string().max(10_000).optional(),
    title: z.string().max(500),
    note: z.string().max(MAX_NOTE_CONTEXT),
    target: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
    original: z.string().max(MAX_TARGET),
    previous: z.string().max(MAX_TARGET).optional(),
});
```

Validate `from <= to`, verify that `note.slice(from, to) === original` when the complete note was
sent, and require an instruction for custom and refine operations. Reject malformed requests before
creating a model.

Use `createLanguageModel` and `streamText` from the AI SDK. Do not enable tools, web search, source
retrieval, or visual output. Pass `request.signal` as the abort signal and return
`result.toTextStreamResponse()`. Convert errors raised before the response starts with
`describeError(error, credentials.apiKey)`. Treat a later stream failure as an opaque failure on
the client; do not serialize a raw provider error into the text stream.

The route keeps no note state and logs no request body. Because it is mounted by the shared Hono
app, the same route works in Vite, the production loopback server, and Electron's main process.

## Visual and accessibility rules

Use Panel UI for the menu, prompt, popover, buttons, and model picker where those parts exist. Use
only semantic colour tokens and Hugeicons. The diff needs semantic additions to the app tokens if
the existing success, danger, and muted tokens cannot express accepted, rejected, added, and
removed states; keep `src/styles/tokens.css` and `site/app/tokens.css` synchronized if tokens change.

All visible text and accessible names live under an `ai` object in both `locales/en/notes.json` and
`locales/he/notes.json`. Controls follow logical positioning utilities. The popover and review
toolbar trap no focus, return focus to the target when closed, and are fully operable by keyboard.

Screen readers announce generation start, completion, cancellation, errors, hunk counts, hunk
decisions, and commit completion through a polite live region. Each hunk identifies its position
and has translated Accept and Reject labels. Motion respects reduced-motion preferences.

## Security and privacy

The feature sends note content only after an explicit action. Context chips disclose whether the
complete note or nearby context will be sent. The request goes only to the chosen provider through
the app's own API, following the existing bring-your-own-key rules.

The route adds no browser host, script, frame, or direct provider call, so it requires no CSP
change. It must support ChatGPT plan credentials through the existing `createLanguageModel` path,
including streaming, `store: false`, and rejected-setting omissions.

Generated Markdown is inert editor text. The feature must not render model output as HTML in a DOM
widget; streaming and diff widgets display it as text. Normal note reading continues to use the
existing Markdown renderer after acceptance.

## Errors and edge cases

| Condition                             | Behavior                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| No configured model                   | Keep the instruction and offer AI provider settings.                        |
| Model override removed                | Fall back to the active model and show a notice before sending.             |
| Target exceeds context                | Refuse the request and suggest a smaller scope or different model.          |
| Empty target for rewrite action       | Do not run; offer Insert at cursor or Ask AI.                               |
| Empty model result                    | Keep the original text and offer Retry.                                     |
| Result equals original                | Say that no changes were proposed; offer Refine or Retry.                   |
| Request aborted                       | Remove partial output and keep the instruction available.                   |
| Target edited                         | Confirm cancellation before allowing the overlapping edit.                  |
| Note switched or editor destroyed     | Abort and discard the session without prompting.                            |
| External body replacement             | Cancel the session before dispatching the replacement.                      |
| RTL or mixed-direction text           | Keep controls logically positioned and let text use its natural direction.  |
| Protected syntax changed unexpectedly | Show it in the diff; never auto-accept or silently repair the model output. |

## Verification

The interface of the deep CodeMirror module is the main test surface. Its tests should create a
real `EditorView` in the test DOM, issue high-level commands, and assert visible state and document
outcomes rather than private fields.

### Pure behavior

Test block and section scope extraction for prose, lists, tasks, code fences, frontmatter, headings,
empty notes, and RTL Markdown. Test context budgeting without splitting surrogate pairs or Markdown
blocks. Test hunk construction, stable ids, mixed accept/reject assembly, insertions, deletions,
identical results, and multi-line replacements.

### Editor behavior

Test selection and slash entry points, trigger removal, streamed widgets staying out of the
document, range mapping after edits before and after the target, overlapping-edit cancellation,
late chunks after abort, note switches, refinement rollback after failure, required hunk decisions,
one-transaction commit, selection restoration, and one-step undo.

### Route behavior

Test schema failures, target mismatch, custom instructions, refinement prompts, provider setup
errors with key redaction, opaque failures after streaming starts, plain text streaming, request
abortion, and that no tools or web-search configuration reaches `streamText`.

### UI behavior

Test keyboard navigation, focus return, translated labels, context disclosure, model override
without settings mutation, no-model setup action, Stop, Retry, Refine, Accept all, Reject all, and
Done. Exercise English and Hebrew layouts.

Before pushing the implementation, run the root lint, typecheck, tests, i18n check, and production
build. The new API route falls under the desktop rule, so also run the desktop typecheck and pack.
If shared tokens change, run the website checks as well.

## Implementation sequence

1. Add the pure request, scope, context, and review types with tests.
2. Add the stateless `/api/notes/edit` route and route tests.
3. Build the deep CodeMirror module and verify mapping, review, commit, and undo through its interface.
4. Add request orchestration, prompt, model override, scopes, context chips, and translated errors.
5. Add the selection menu and `/ai` completion, then connect preset actions and Continue writing.
6. Add refinement, retry, abort, accessibility announcements, and conflict handling.
7. Run browser checks in English and Hebrew, then complete the root and desktop verification suites.

## Acceptance criteria

The feature is complete when a user can select Markdown, run every preset action, see a streamed
temporary proposal, accept and reject individual diff hunks, apply the choices together, and undo
the entire accepted operation once. Ask AI must support all four no-selection scopes, a request-only
model override, refinement against the original target, and visible context disclosure.

No partial generation may enter the note or autosave. Editing outside the target must keep the
preview correctly anchored, while editing the target must require cancellation. The same behavior
must work in the web and desktop apps, in English and Hebrew, without storing prompts, credentials,
results, or AI provenance beyond the accepted note text.
