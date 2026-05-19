import { notFound } from "next/navigation";
import Link from "next/link";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";
import EditorialHero from "../_components/EditorialHero.js";
import EditorialBody from "../_components/EditorialBody.js";
import PiecesFeatured from "../_components/PiecesFeatured.js";
import MoreFromDesigner from "../_components/MoreFromDesigner.js";
import { fetchEditorialProducts } from "../_lib/fetchEditorialProducts.js";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "Not found · Dépôt" };
  return {
    title: `${entry.hero.title} · Editorial · Dépôt`,
    description: entry.hero.subtitle?.replace(/\n/g, " ").slice(0, 200),
  };
}

export default async function EditorialEntryPage({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  const { curated, moreFrom } = await fetchEditorialProducts({
    curatedProducts: entry.curatedProducts,
    brandFilter: entry.brandFilter,
    moreFromLimit: 8,
    minCurated: 4,
  });

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <EditorialHero entry={entry} />
      <EditorialBody entry={entry} />
      <PiecesFeatured products={curated} />
      <MoreFromDesigner designerName={entry.hero.title} products={moreFrom} />
      <div className="text-center pb-16 md:pb-20">
        <Link
          href="/editorial"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600 border-b border-zinc-900/20 pb-1"
        >
          ← Back to editorial
        </Link>
      </div>
    </main>
  );
}
