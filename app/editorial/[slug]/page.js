import { notFound } from "next/navigation";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";
import EditorialHero from "../_components/EditorialHero.js";

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
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <EditorialHero entry={entry} />
    </main>
  );
}
