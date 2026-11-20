import heMarkdownEditor from "@/locales/he/markdownEditor.json";
import enMarkdownEditor from "@/locales/en/markdownEditor.json";
import enChat from "@/locales/en/chat.json";
import enCommon from "@/locales/en/common.json";
import enHome from "@/locales/en/home.json";
import enNotes from "@/locales/en/notes.json";
import enSettings from "@/locales/en/settings.json";
import enSources from "@/locales/en/sources.json";
import enStudio from "@/locales/en/studio.json";
import enWorkspace from "@/locales/en/workspace.json";
import heChat from "@/locales/he/chat.json";
import heCommon from "@/locales/he/common.json";
import heHome from "@/locales/he/home.json";
import heNotes from "@/locales/he/notes.json";
import heSettings from "@/locales/he/settings.json";
import heSources from "@/locales/he/sources.json";
import heStudio from "@/locales/he/studio.json";
import heWorkspace from "@/locales/he/workspace.json";

/**
 * Every translation, bundled. English is the source of truth: other languages
 * must have the same keys (checked by `npm run i18n:check`).
 */
export const resources = {
  en: {
    common: enCommon,
    home: enHome,
    workspace: enWorkspace,
    studio: enStudio,
    notes: enNotes,
    markdownEditor: enMarkdownEditor,
    settings: enSettings,
    chat: enChat,
    sources: enSources,
  },
  he: {
    common: heCommon,
    home: heHome,
    workspace: heWorkspace,
    studio: heStudio,
    notes: heNotes,
    markdownEditor: heMarkdownEditor,
    settings: heSettings,
    chat: heChat,
    sources: heSources,
  },
} as const;
