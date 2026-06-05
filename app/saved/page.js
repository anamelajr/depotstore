import T from "../components/T";
import { getLanguage } from "../lib/i18n/language.js";
import { t } from "../lib/i18n/messages.js";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const lang = await getLanguage();
  return {
    title: t("meta.savedTitle", lang),
  };
}

export default function SavedPage() {
  return (
    <main className="flex min-h-[calc(100vh-var(--nav-height))] flex-col items-center justify-center px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600 mb-4">
        <T k="saved.label" />
      </p>
      <p className="font-mono text-[13px] uppercase tracking-widest text-zinc-300">
        <T k="saved.comingSoon" />
      </p>
      <p className="mt-6 max-w-sm text-center text-sm leading-7 text-zinc-500">
        <T k="saved.body" />
      </p>
    </main>
  );
}
