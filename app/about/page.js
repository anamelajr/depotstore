import Link from "next/link";
import T from "../components/T";
import { getLanguage } from "../lib/i18n/language.js";
import { t } from "../lib/i18n/messages.js";

export async function generateMetadata() {
  const lang = await getLanguage();
  return {
    title: t("meta.aboutTitle", lang),
    description: t("meta.aboutDesc", lang),
  };
}

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-950">
      <div className="mx-auto max-w-2xl px-6 py-24 sm:py-32">

        {/* Back link */}
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-950 transition-colors"
        >
          <T k="about.back" />
        </Link>

        {/* Wordmark */}
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 mt-16 mb-12">
          <T k="about.pageLabel" />
        </p>

        {/* Lead */}
        <h1 className="text-4xl sm:text-5xl font-light leading-tight tracking-tight text-zinc-900 mb-10">
          <T k="about.lead" />
        </h1>

        {/* Body */}
        <p className="text-base leading-8 text-zinc-600 mb-16">
          <T k="about.body" />
        </p>

        {/* Closing line */}
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
          <T k="about.closing" />
        </p>

        {/* CTA */}
        <div className="mt-16 pt-16 border-t border-zinc-200">
          <Link
            href="/feed"
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-600 hover:text-zinc-950 transition-colors"
          >
            <T k="about.cta" />
          </Link>
        </div>

      </div>
    </main>
  );
}