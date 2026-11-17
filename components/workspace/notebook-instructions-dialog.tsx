import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/common/field";
import { Button } from "@/components/panelui/button";
import { Dialog } from "@/components/panelui/dialog";
import { Textarea } from "@/components/panelui/textarea";
import { updateNotebook } from "@/lib/db/notebooks";
import { useWorkspace } from "./workspace-context";

const MAX_INSTRUCTIONS_LENGTH = 10_000;

export function NotebookInstructionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("workspace");
  const { t: tCommon } = useTranslation();
  const { notebook } = useWorkspace();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" closeLabel={tCommon("actions.close")}>
        <Dialog.Header
          title={t("chatInstructions.title")}
          description={t("chatInstructions.description")}
        />
        {open ? (
          <InstructionsForm
            initial={notebook.chatInstructions ?? ""}
            label={t("chatInstructions.label")}
            hint={t("chatInstructions.hint")}
            saveLabel={tCommon("actions.save")}
            cancelLabel={tCommon("actions.cancel")}
            onSave={async (chatInstructions) => {
              await updateNotebook(notebook.id, { chatInstructions });
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </Dialog.Content>
    </Dialog>
  );
}

function InstructionsForm({
  initial,
  label,
  hint,
  saveLabel,
  cancelLabel,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  hint: string;
  saveLabel: string;
  cancelLabel: string;
  onSave: (instructions: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation("workspace");
  const fieldId = useId();
  const formId = useId();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  return (
    <>
      <Dialog.Body>
        <form
          id={formId}
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            setSaving(true);
            setSaveError(false);
            try {
              await onSave(value.trim());
            } catch {
              setSaveError(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label={label} htmlFor={fieldId} hint={hint}>
            <Textarea
              id={fieldId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaveError(false);
              }}
              maxLength={MAX_INSTRUCTIONS_LENGTH}
              rows={8}
              autoResize={false}
            />
          </Field>
          {saveError ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t("chatInstructions.saveError")}
            </p>
          ) : null}
        </form>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" form={formId} disabled={saving}>
          {saveLabel}
        </Button>
      </Dialog.Footer>
    </>
  );
}
