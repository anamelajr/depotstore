import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import { withVisibility } from "../lib/productQueries.js";

async function fetchMore(storeDomain) {
  const { data, error } = await withVisibility(
    supabase
      .from("products")
      .select("name, title, brand, price, image_url, store_domain, product_url, available, handle")
      .eq("store_domain", storeDomain),
  )
    .order("synced_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[MoreFromStore] Supabase fetch error:", error.message);
    return [];
  }
  return (data || []).map((row) => ({
    title: row.title,
    name: row.name,
    brand: row.brand,
    price: row.price,
    imageUrl: row.image_url,
    storeDomain: row.store_domain,
    available: row.available,
    handle: row.handle,
  }));
}

export default async function MoreFromStore({ storeDomain, currentHandle, storeName }) {
  if (!storeDomain) return null;

  const products = (await fetchMore(storeDomain))
    .filter((p) => p.handle !== currentHandle)
    .slice(0, 4);

  if (products.length === 0) return null;

  const heading = storeName ? `More from ${storeName}` : "More from this store";

  return (
    <section className="mt-16 px-6 pb-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900">
        {heading}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-5">
        {products.map((p) => {
          const href = p.handle && p.storeDomain
            ? `/product/${p.handle}?store=${p.storeDomain}&available=${p.available !== false}`
            : null;
          const card = (
            <div className="block">
              <div className="aspect-[3/4] w-full overflow-hidden bg-zinc-100">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.title ?? p.name ?? ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              {p.brand ? (
                <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
                  {p.brand}
                </p>
              ) : null}
              <p className="mt-1 font-sans text-[13px] leading-[1.3] text-zinc-600 line-clamp-2">
                {p.title ?? p.name ?? "Untitled"}
              </p>
              {p.price ? (
                <p className="mt-1.5 font-mono text-[11px] text-zinc-700">
                  {p.price}
                </p>
              ) : null}
            </div>
          );
          if (!href) return <div key={`${p.storeDomain}-${p.handle}`}>{card}</div>;
          return (
            <Link
              key={`${p.storeDomain}-${p.handle}`}
              href={href}
              className="block focus:outline-none"
            >
              {card}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
