import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";
import EditorialHero from "../_components/EditorialHero.js";
import EditorialBody from "../_components/EditorialBody.js";
import PiecesFeatured from "../_components/PiecesFeatured.js";
import MoreFromDesigner from "../_components/MoreFromDesigner.js";
import { fetchEditorialProducts } from "../_lib/fetchEditorialProducts.js";

// Refresh the live "Pieces featured" + "More from" grids on the same cadence
// as the Shopify→Supabase sync. Without this, generateStaticParams would
// freeze inventory data into the build artifact.
export const revalidate = 3600;

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

  // The root layout reads cookies() for the currency selector, which opts this
  // page into dynamic (per-request) rendering — that removes the €→£ price
  // flicker the static build would otherwise show. Wrapping the product fetch
  // in unstable_cache keeps the live inventory data on the hourly cadence so
  // going dynamic doesn't hit Supabase on every request. Explicit per-slug
  // keyPart belt-and-suspenders against a future closure-capture mis-impl
  // (unstable_cache also keys on the arguments below).
  const getCachedEditorialProducts = unstable_cache(
    fetchEditorialProducts,
    ["editorial-products", slug],
    { revalidate: 3600 },
  );
  const { curated, moreFrom } = await getCachedEditorialProducts({
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
