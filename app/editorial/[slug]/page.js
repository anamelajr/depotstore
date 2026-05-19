import { notFound } from "next/navigation";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "Not found · Dépôt" };
  return { title: `${entry.hero.title} · Editorial · Dépôt` };
}

export default async function EditorialEntryPage({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900 px-8 py-12">
      <pre className="font-mono text-[11px] overflow-x-auto">
        {JSON.stringify(entry, null, 2)}
      </pre>
    </main>
  );
}
