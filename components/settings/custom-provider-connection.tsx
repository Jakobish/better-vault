import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/common/field";
import { Button } from "@/components/panelui/button";
import { Input } from "@/components/panelui/input";
import { customProviderBaseURL } from "@/lib/ai/custom-provider";
import type { CustomProviderSettings } from "@/lib/db/settings";

type Connection = Pick<CustomProviderSettings, "name" | "baseURL" | "apiKey">;

export function CustomProviderConnection({
  saved,
  onSave,
}: {
  saved?: Connection;
  onSave: (connection: Connection) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation();
  const nameId = useId();
  const urlId = useId();
  const keyId = useId();
  const [name, setName] = useState(saved?.name ?? "");
  const [url, setURL] = useState(saved?.baseURL ?? "");
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const baseURL = customProviderBaseURL(url);
  const changed =
    name.trim() !== saved?.name || baseURL !== saved?.baseURL || apiKey.trim() !== saved?.apiKey;

  async function submit() {
    if (!name.trim() || !baseURL || !changed || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave({ name: name.trim(), baseURL, apiKey: apiKey.trim() });
      setURL(baseURL);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label={t("providers.custom.name")} htmlFor={nameId}>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
        />
      </Field>
      <Field
        label={t("providers.custom.baseURL")}
        hint={t("providers.custom.baseURLHint")}
        htmlFor={urlId}
      >
        <Input
          id={urlId}
          type="url"
          dir="ltr"
          spellCheck={false}
          placeholder="https://example.com/v1"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          maxLength={500}
          required
        />
      </Field>
      {url.trim() && !baseURL ? (
        <p className="text-xs text-destructive">{t("providers.custom.invalidURL")}</p>
      ) : null}
      <Field label={t("providers.custom.apiKey")} htmlFor={keyId}>
        <Input
          id={keyId}
          type="password"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          maxLength={500}
        />
      </Field>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("providers.custom.saveFailed")}
        </p>
      ) : null}
      <Button
        type="submit"
        className="self-start"
        disabled={!name.trim() || !baseURL || !changed}
        loading={saving}
      >
        {saved ? tCommon("actions.save") : t("providers.custom.add")}
      </Button>
    </form>
  );
}
