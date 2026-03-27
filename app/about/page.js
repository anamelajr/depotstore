import Link from "next/link";

export const metadata = {
  title: "About — Dépôt",
  description: "Dépôt is a curated discovery platform for archive and luxury fashion in Paris.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-50">
      <div className="mx-auto max-w-2xl px-6 py-24 sm:py-32">

        {/* Back link */}
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          ← Back
        </Link>

        {/* Wordmark */}
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-600 mt-16 mb-12">
          About
        </p>

        {/* Lead */}
        <h1 className="text-4xl sm:text-5xl font-light leading-tight tracking-tight text-zinc-100 mb-10">
          Dépôt is a curated discovery platform for archive and luxury fashion in Paris.
        </h1>

        {/* Body */}
        <p className="text-base leading-8 text-zinc-400 mb-16">
          Live inventory from the city's best vintage and archive stores, in one feed. Search by designer, filter by category, get lost.
        </p>

        {/* Closing line */}
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-600">
          Paris first. More cities soon.
        </p>

        {/* CTA */}
        <div className="mt-16 pt-16 border-t border-zinc-900">
          <Link
            href="/feed"
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 hover:text-zinc-50 transition-colors"
          >
            Browse the feed →
          </Link>
        </div>

      </div>
    </main>
  );
}