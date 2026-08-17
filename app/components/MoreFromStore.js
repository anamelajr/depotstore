import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import HoverSwapImage from "./HoverSwapImage.js";
import Price from "./Price.js";
import T from "./T";
import {
  withVisibility,
  PRODUCT_ROW_SELECT,
  mapProductRow,
} from "../lib/productQueries.js";

async function fetchMore(storeDomain) {
  const { data, error } = await withVisibility(
    supabase
      .from("products")
      .select(PRODUCT_ROW_SELECT)
      .eq("store_domain", storeDomain),
  )
    .order("synced_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[MoreFromStore] Supabase fetch error:", error.message);
    return [];
  }
  return (data || []).map(mapProductRow);
}

export default async function MoreFromStore({ storeDomain, currentHandle, storeName }) {
  if (!storeDomain) return null;

  const products = (await fetchMore(storeDomain))
    .filter((p) => p.handle !== currentHandle)
    .slice(0, 4);

  if (products.length === 0) return null;

  return (
    <section className="mt-16 px-6 lg:px-0 pb-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900">
        {storeName ? (
          <>
            <T k="product.moreFrom" /> {storeName}
          </>
        ) : (
          <T k="product.moreFromThis" />
        )}
      </p>
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
        {products.map((p) => {
          const href = p.handle && p.storeDomain
            ? `/product/${p.handle}?store=${p.storeDomain}&available=${p.available !== false}`
            : null;
          const card = (
            <div className="group block">
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100">
                {p.imageUrl ? (
                  <HoverSwapImage
                    imageUrl={p.imageUrl}
                    imageUrl2={p.imageUrl2}
                    alt={p.title ?? p.name ?? ""}
                    sizes="(min-width: 1024px) 25vw, 50vw"
                  />
                ) : null}
              </div>
              {p.brand ? (
                <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
                  {p.brand}
                </p>
              ) : null}
              <p className="mt-1 font-sans text-[13px] leading-[1.3] text-zinc-600 line-clamp-2">
                {p.title ?? p.name ?? <T k="product.untitled" />}
              </p>
              {p.price ? (
                <Price eur={p.price} className="mt-1.5 block font-mono text-[11px] text-zinc-700" />
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
