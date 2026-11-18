import { Book02Icon, Delete02Icon, Idea01Icon, RepeatIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { useChatSession } from "@/components/chat/chat-provider";
import { Icon } from "@/components/icon";
import { Message } from "@/components/panelui/message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createNote } from "@/lib/db/notes";
import { useSources } from "@/lib/db/sources";
import { DEFAULT_VAULT } from "@/lib/db/vaults";
import { useWorkspace } from "./workspace-context";

const SUGGESTIONS = ["summary", "questions", "terms", "plan"] as const;

/** The conversation with the notebook. */
export function ChatView() {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  const { notebook, readSource } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const last = chat.messages.at(-1);

  // Follows the answer as it is written, unless the reader has scrolled up.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) {
      element.scrollTo({ top: element.scrollHeight });
    }
  }, [chat.messages]);

  if (chat.messages.length === 0) return <EmptyChat />;

  const runAction = (action: () => Promise<void>) => {
    void action().catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  };
  const retry = () => runAction(chat.retry);
  const busy = chat.status === "submitted" || chat.status === "streaming";

  return (
    <ScrollArea className="h-full" viewportRef={scroller}>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-4 pb-56 sm:px-6">
        {chat.messages.map((message, at) =>
          message.role === "user" ? (
            <Message key={message.id} from="user">
              <Message.Content className="gap-1">
                <Message.Bubble>
                  <Message.BubbleContent className="whitespace-pre-wrap">
                    {message.parts
                      .flatMap((part) => (part.type === "text" ? [part.text] : []))
                      .join("\n")}
                  </Message.BubbleContent>
                </Message.Bubble>
                <Message.Actions
                  aria-label={t("actions.label")}
                  reveal={at === chat.messages.length - 1 ? "always" : "hover"}
                  className="justify-end"
                >
                  <Message.Action
                    label={t("actions.sendAgain")}
                    disabled={busy}
                    onClick={() => runAction(() => chat.resend(message))}
                  >
                    <Icon icon={RepeatIcon} />
                  </Message.Action>
                  <Message.Action
                    label={t("actions.delete")}
                    disabled={busy}
                    onClick={() => runAction(() => chat.removeMessage(message.id))}
                  >
                    <Icon icon={Delete02Icon} />
                  </Message.Action>
                </Message.Actions>
              </Message.Content>
            </Message>
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              streaming={chat.status === "streaming" && at === chat.messages.length - 1}
              isLast={at === chat.messages.length - 1}
              actionsDisabled={busy}
              onRetry={retry}
              onCreateNote={(text) =>
                runAction(async () => {
                  const body = text;
                  const title = body.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
                  const note = await createNote({
                    vaultId: notebook.vaultId ?? DEFAULT_VAULT,
                    notebookId: notebook.id,
                    title: title || t("actions.answerNote"),
                    body,
                  });
                  toast.success(t("actions.noteCreated", { title: note.title }));
                })
              }
              onDelete={() => runAction(() => chat.removeMessage(message.id))}
              onOpenPassage={(passage) => readSource(passage.sourceId, passage.chunkId)}
            />
          ),
        )}
        {chat.status === "submitted" && last?.role === "user" ? (
          <Message from="assistant">
            <Message.Content>
              <Message.Status>{t("status.thinking")}</Message.Status>
            </Message.Content>
          </Message>
        ) : null}
        {chat.status === "error" && chat.error ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="min-w-0 flex-1">{t("error", { error: chat.error.message })}</span>
            <button
              type="button"
              onClick={retry}
              className="shrink-0 cursor-pointer font-medium underline-offset-4 hover:underline"
            >
              {t("actions.retry")}
            </button>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function EmptyChat() {
  const { t } = useTranslation("chat");
  const chat = useChatSession();
  const { notebook, setAddSourceOpen } = useWorkspace();
  const sources = useSources(notebook.id);
  const selected = sources?.filter((source) => source.selected).length ?? 0;

  return (
    <ScrollArea className="h-full">
      <div className="flex min-h-full flex-col items-center justify-center px-4 pt-6 pb-48 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("empty.title")}</h2>
        {sources && selected === 0 ? (
          <>
            <p className="mt-2 max-w-md text-muted-foreground">{t("empty.noSources")}</p>
            <button
              type="button"
              onClick={() => setAddSourceOpen(true)}
              className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium transition-colors outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon icon={Book02Icon} size={16} />
              {t("addSource")}
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-md text-muted-foreground">
              {t("empty.body", { count: selected })}
            </p>
            <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={chat.status === "submitted" || chat.status === "streaming"}
                  onClick={() =>
                    chat
                      .send(t(`empty.suggestions.${key}`))
                      .catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : String(error)),
                      )
                  }
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Icon icon={Idea01Icon} size={16} className="text-chart-4" />
                  {t(`empty.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
