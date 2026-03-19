"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "./components/ProductCard";
import StoreFilterBar from "./components/StoreFilterBar";
import BRANDS from "./brands";

const ALL_STORES_VALUE = "ALL";
const PAGE_SIZE = 40;
const CONTACT_EMAIL = "hello@depot.paris";

const BAG_KEYWORDS = [
  "bag",
  "crossbody",
  "backpack",
  "handbag",
  "tote",
  "document holder",
  "wallet",
  "pouchette",
  "furkin",
  "purse",
];

const ACCESSORY_KEYWORDS = [
  "sunglasses",
  "bracelet",
  "necklace",
  "gloves",
  "hat",
  "scarf",
  "belt",
  "cap",
  "beanie",
  "headband",
];

const TOPS_KEYWORDS = [
  "shirt",
  "sweater",
  "cardigan",
  "hoodie",
  "t-shirt",
  "tee",
  "t shirt",
  "knitwear",
  "polo",
  "striped polo",
  "longsleeve",
  "longsleeves",
  "sweat-shirt",
  "sweat",
  "crewneck",
  "knit",
  "blouse",
  "tunic",
  "jackey",
  "corset",
  "vest",
  "shawl",
  "waistcoat",
  "bolero",
  "cape",
  "legging",
];

const BOTTOMS_KEYWORDS = [
  "denim",
  "jeans",
  "pants",
  "pant",
  "shorts",
  "trousers",
  "joggers",
  "hysteric glamour",
];

const JACKETS_COATS_KEYWORDS = [
  "jacket",
  "blazer",
  "coat",
  "bomber",
  "puffer",
  "trench",
  "fur",
];

const DRESSES_SKIRTS_KEYWORDS = ["dress", "mini dress", "gown", "skirt", "jumpsuit"];

const TOPS_HOODIES_SWEATERS_KEYWORDS = ["hoodie", "sweat", "sweat-shirt", "crewneck"];
const TOPS_SHIRTS_BLOUSES_KEYWORDS = ["shirt", "blouse", "polo", "tunic"];
const TOPS_TEES_KEYWORDS = ["tee", "t-shirt", "t shirt"];
const TOPS_KNITWEAR_KEYWORDS = ["sweater", "cardigan", "knit", "knitwear"];

const JACKETS_KEYWORDS = ["jacket", "bomber", "blazer", "puffer"];
const COATS_KEYWORDS = ["coat", "trench", "cape"];
const FOOTWEAR_KEYWORDS = [
  "boots",
  "boot",
  "sneakers",
  "shoes",
  "loafers",
  "heels",
  "sandals",
  "mules",
  "pumps",
];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractBrandTags(title) {
  const t = normalizeText(title);
  const matches = [];

  for (const brand of BRANDS) {
    const nb = normalizeText(brand);
    if (!nb) continue;
    if (t.includes(nb)) matches.push(brand);
  }

  // De-dupe while keeping first occurrence order.
  return Array.from(new Set(matches));
}

function containsAnyKeyword(text, keywords) {
  return keywords.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(text);
  });
}

function hasSetsKeyword(text) {
  return containsAnyKeyword(text, [
    "set",
    "two piece",
    "three piece",
    "2 piece",
    "3 piece",
    "2p",
  ]);
}

function classifyProduct(product) {
  const t = normalizeText(product?.name ?? "");
  const categories = new Set();
  const hasBags = containsAnyKeyword(t, BAG_KEYWORDS);
  const hasAccessories = containsAnyKeyword(t, ACCESSORY_KEYWORDS);
  const hasFootwear = containsAnyKeyword(t, FOOTWEAR_KEYWORDS);
  const hasSets = hasSetsKeyword(t);
  const hasDressesSkirts = containsAnyKeyword(t, DRESSES_SKIRTS_KEYWORDS);
  const hasJackets = containsAnyKeyword(t, JACKETS_KEYWORDS);
  const hasCoats = containsAnyKeyword(t, COATS_KEYWORDS);
  const hasJacketsCoats = containsAnyKeyword(t, JACKETS_COATS_KEYWORDS);
  const hasTops = containsAnyKeyword(t, TOPS_KEYWORDS);
  const hasBottomsCore = containsAnyKeyword(t, BOTTOMS_KEYWORDS);
  const hasDenim = containsAnyKeyword(t, ["denim"]);

  // Priority 1: Bags & Accessories
  // Bags are always primary. Accessories (e.g. belt) may be descriptors — if the product
  // also has a primary clothing keyword (jacket, dress, shorts, etc.), the higher-priority
  // category wins and we skip Bags & Accessories.
  if (hasBags) {
    categories.add("bags_accessories");
    categories.add("bags");
    if (hasAccessories) categories.add("accessories");
    return { categories };
  }
  if (hasAccessories) {
    const hasPrimaryClothing =
      hasDressesSkirts ||
      hasJacketsCoats ||
      hasTops ||
      hasBottomsCore ||
      (hasDenim && !hasJacketsCoats);
    if (!hasPrimaryClothing) {
      categories.add("bags_accessories");
      categories.add("accessories");
      return { categories };
    }
    // Fall through — let Jackets & Coats, Dresses & Skirts, Tops, or Bottoms win
  }

  // Priority 2: Footwear
  if (hasFootwear) {
    categories.add("footwear");
    return { categories };
  }

  // Priority 3: Sets
  if (hasSets) {
    categories.add("sets");
    return { categories };
  }

  // Priority 4: Dresses & Skirts
  if (hasDressesSkirts) {
    categories.add("dresses_skirts");
    return { categories };
  }

  // Priority 5: Jackets & Coats
  if (hasJacketsCoats) {
    categories.add("jackets_coats");
    if (hasJackets) categories.add("jackets");
    if (hasCoats) categories.add("coats");
    return { categories };
  }

  // Priority 6: Tops
  if (hasTops) {
    categories.add("tops");
    if (containsAnyKeyword(t, TOPS_HOODIES_SWEATERS_KEYWORDS)) {
      categories.add("tops_hoodies_sweaters");
    }
    if (containsAnyKeyword(t, TOPS_SHIRTS_BLOUSES_KEYWORDS)) {
      categories.add("tops_shirts_blouses");
    }
    if (containsAnyKeyword(t, TOPS_TEES_KEYWORDS)) categories.add("tops_tees");
    if (containsAnyKeyword(t, TOPS_KNITWEAR_KEYWORDS)) categories.add("tops_knitwear");
    return { categories };
  }

  // Priority 7: Bottoms (denim only if no jacket/coat keyword)
  if (hasBottomsCore || (hasDenim && !hasJacketsCoats)) {
    categories.add("bottoms");
    return { categories };
  }

  return { categories };
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [selectedStore, setSelectedStore] = useState(ALL_STORES_VALUE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const scrollToFeed = () => {
    document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/products");
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        if (!cancelled) setProducts(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Failed to load products");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  const storeOptions = useMemo(() => {
    const stores = Array.from(
      new Set(products.map((p) => p?.storeName).filter(Boolean))
    );

    return [
      { value: ALL_STORES_VALUE, label: "All Stores" },
      ...stores.map((s) => ({ value: s, label: s })),
    ];
  }, [products]);

  // Extract brands from all inventory (not affected by store selection).
  const brandOptions = useMemo(() => {
    const counts = new Map(); // brand -> match count across the current inventory

    for (const p of products) {
      const title = p?.name ?? "";
      const brandsInTitle = extractBrandTags(title);
      for (const b of brandsInTitle) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
    }

    // Only show brands that actually match at least one product title.
    // Keep the curated list order as a baseline, then fall back to count.
    return BRANDS.filter((b) => counts.has(b)).sort((a, b) => {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      return cb - ca || a.localeCompare(b);
    });
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(searchQuery).trim();
    const hasQuery = q.length > 0;
    const hasBrand = typeof selectedBrand === "string" && selectedBrand.length > 0;
    const selectedBrandNorm = hasBrand ? normalizeText(selectedBrand) : null;

    return products.filter((p) => {
      const classification = classifyProduct(p);

      if (selectedStore !== ALL_STORES_VALUE) {
        if (p?.storeName !== selectedStore) return false;
      }

      if (hasQuery) {
        const titleNorm = normalizeText(p?.name ?? "");
        if (!titleNorm.includes(q)) return false;
      }

      if (hasBrand) {
        const titleNorm = normalizeText(p?.name ?? "");
        if (!titleNorm.includes(selectedBrandNorm)) return false;
      }

      if (selectedCategory && !classification.categories.has(selectedCategory)) {
        return false;
      }

      return true;
    });
  }, [products, selectedStore, searchQuery, selectedBrand, selectedCategory]);

  // Reset pagination any time the backing dataset or store changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStore, products, searchQuery, selectedBrand, selectedCategory]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  }, [filteredProducts.length]);

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  const paginationItems = useMemo(() => {
    if (totalPages <= 1) return [];
    const side = 2;

    const pages = new Set([1, totalPages]);
    for (let p = currentPage - side; p <= currentPage + side; p++) {
      if (p >= 1 && p <= totalPages) pages.add(p);
    }

    const sorted = Array.from(pages).sort((a, b) => a - b);
    const items = [];

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const prev = sorted[i - 1];
      if (i > 0 && p - prev > 1) items.push("…");
      items.push(p);
    }

    return items;
  }, [currentPage, totalPages]);

  const sortedDesignerBrands = useMemo(() => {
    return [...BRANDS].sort((a, b) => a.localeCompare(b));
  }, []);

  return (
    <div className="min-h-screen font-mono antialiased">
      <nav className="sticky top-0 z-50 border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto whitespace-nowrap px-4 py-3 text-[11px] uppercase tracking-widest">
          <div className="group relative">
            <button
              type="button"
              onClick={() => setSelectedCategory("tops")}
              className={[
                "transition-colors",
                selectedCategory?.startsWith("tops")
                  ? "text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-200",
              ].join(" ")}
            >
              Tops
            </button>
            <div className="invisible absolute left-0 top-full z-50 mt-2 min-w-[220px] border border-zinc-800 bg-[#0a0a0a] p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
              {[
                ["tops", "All Tops"],
                ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
                ["tops_shirts_blouses", "Shirts & Blouses"],
                ["tops_tees", "Tees"],
                ["tops_knitwear", "Knitwear"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedCategory(value)}
                  className="block w-full px-2 py-1 text-left text-[11px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCategory("bottoms")}
            className={[
              "transition-colors",
              selectedCategory === "bottoms" ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200",
            ].join(" ")}
          >
            Bottoms
          </button>

          <button
            type="button"
            onClick={() => setSelectedCategory("dresses_skirts")}
            className={[
              "transition-colors",
              selectedCategory === "dresses_skirts"
                ? "text-zinc-50"
                : "text-zinc-500 hover:text-zinc-200",
            ].join(" ")}
          >
            Dresses & Skirts
          </button>

          <div className="group relative">
            <button
              type="button"
              onClick={() => setSelectedCategory("jackets_coats")}
              className={[
                "transition-colors",
                selectedCategory === "jackets_coats" ||
                selectedCategory === "jackets" ||
                selectedCategory === "coats"
                  ? "text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-200",
              ].join(" ")}
            >
              Jackets & Coats
            </button>
            <div className="invisible absolute left-0 top-full z-50 mt-2 min-w-[220px] border border-zinc-800 bg-[#0a0a0a] p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
              {[
                ["jackets_coats", "All Jackets & Coats"],
                ["jackets", "Jackets"],
                ["coats", "Coats"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedCategory(value)}
                  className="block w-full px-2 py-1 text-left text-[11px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCategory("footwear")}
            className={[
              "transition-colors",
              selectedCategory === "footwear" ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200",
            ].join(" ")}
          >
            Footwear
          </button>

          <div className="group relative">
            <button
              type="button"
              onClick={() => setSelectedCategory("bags_accessories")}
              className={[
                "transition-colors",
                selectedCategory === "bags_accessories" ||
                selectedCategory === "bags" ||
                selectedCategory === "accessories"
                  ? "text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-200",
              ].join(" ")}
            >
              Bags & Accessories
            </button>
            <div className="invisible absolute left-0 top-full z-50 mt-2 min-w-[220px] border border-zinc-800 bg-[#0a0a0a] p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
              {[
                ["bags_accessories", "All Bags & Accessories"],
                ["bags", "Bags"],
                ["accessories", "Accessories"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedCategory(value)}
                  className="block w-full px-2 py-1 text-left text-[11px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedCategory("sets")}
            className={[
              "transition-colors",
              selectedCategory === "sets" ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200",
            ].join(" ")}
          >
            Sets
          </button>

          <div className="group relative">
            <button
              type="button"
              className={[
                "transition-colors",
                selectedBrand ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200",
              ].join(" ")}
            >
              Designers
            </button>
            <div className="invisible absolute left-0 top-full z-50 mt-2 max-h-72 w-[560px] overflow-y-auto border border-zinc-800 bg-[#0a0a0a] p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {sortedDesignerBrands.map((brand) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => setSelectedBrand(brand)}
                    className="block w-full px-2 py-1 text-left text-[11px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    {brand}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAboutOpen(true)}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
          >
            About
          </button>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="normal-case text-zinc-500 transition-colors hover:text-zinc-200"
          >
            Contact
          </a>
        </div>
      </nav>

      <section className="relative flex min-h-screen flex-col bg-[#f5f2ed] text-zinc-950">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-8">
          <div className="max-w-4xl">
            <div className="text-[clamp(60px,10vw,132px)] font-bold uppercase leading-[0.9] tracking-tight">
              DÉPÔT
            </div>
            <div className="mt-6 max-w-2xl text-sm leading-6 text-zinc-800">
              Paris. Archive. One feed.
            </div>
          </div>

          <div className="mt-16 max-w-3xl">
            <div className="">
              <label htmlFor="hero-search" className="sr-only">
                Search products
              </label>
              <input
                id="hero-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, brand, keyword…"
                className="w-full rounded-none border-b border-zinc-300 bg-transparent py-4 text-lg text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-zinc-800"
              />
            </div>

            {brandOptions.length > 0 ? (
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
                {brandOptions.slice(0, 12).map((brand) => {
                  const active = brand === selectedBrand;
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() =>
                        setSelectedBrand((current) =>
                          current === brand ? null : brand
                        )
                      }
                      aria-pressed={active}
                      className={[
                        "text-[11px] font-mono uppercase tracking-widest transition-colors",
                        active
                          ? "text-zinc-950 underline decoration-zinc-800 underline-offset-4"
                          : "text-zinc-500 hover:text-zinc-900",
                      ].join(" ")}
                    >
                      {brand}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-8">
              <StoreFilterBar
                variant="light"
                options={storeOptions}
                selectedValue={selectedStore}
                onChange={setSelectedStore}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 pb-12">
          <button
            type="button"
            onClick={scrollToFeed}
            className="flex w-fit items-center gap-2 text-sm text-zinc-900/80 transition-colors hover:text-zinc-900"
          >
            <span className="underline decoration-zinc-800 underline-offset-4">
              Browse
            </span>
            <span aria-hidden="true" className="text-lg leading-none">
              ↓
            </span>
          </button>
        </div>
      </section>

      <div id="feed" className="min-h-screen bg-[#0a0a0a] text-zinc-50">
        <header className="sticky top-0 z-10 border-b border-zinc-800/70 bg-[#0a0a0a]/85 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-sans text-[20px] font-medium tracking-tight">
                  Dépôt
                </h2>
              </div>

              <div className="flex items-center gap-8">
                <button
                  type="button"
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
                >
                  Back to top ↑
                </button>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-zinc-800/50 pt-6">
              <div className="flex-1 min-w-[240px]">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter grid..."
                  className="w-full border-none bg-transparent p-0 text-sm text-zinc-50 placeholder:text-zinc-600 outline-none"
                />
              </div>

              <StoreFilterBar
                options={storeOptions}
                selectedValue={selectedStore}
                onChange={setSelectedStore}
              />
            </div>

            <div className="mt-3 text-[11px] uppercase tracking-widest text-zinc-600">
              Showing {paginatedProducts.length} of {filteredProducts.length} products
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-24 pt-12">
          {loading ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              Loading products…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-red-300">
              {error}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              No products found for this store.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-10 lg:grid-cols-3">
                {paginatedProducts.map((p) => (
                  <ProductCard
                    key={`${p.productUrl ?? "unknown"}-${p.name}`}
                    product={p}
                  />
                ))}
              </div>

              {totalPages > 1 ? (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className={[
                      "text-xs uppercase tracking-widest transition-colors",
                      currentPage <= 1
                        ? "cursor-not-allowed text-zinc-600"
                        : "text-zinc-500 hover:text-zinc-200",
                    ].join(" ")}
                  >
                    ←
                  </button>

                  {paginationItems.map((item, idx) => {
                    if (item === "…") {
                      return (
                        <span
                          key={`ellipsis-${idx}`}
                          className="text-xs uppercase tracking-widest text-zinc-600"
                        >
                          …
                        </span>
                      );
                    }

                    const page = item;
                    const active = page === currentPage;
                    return (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setCurrentPage(page)}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "text-xs uppercase tracking-widest transition-colors",
                          active
                            ? "text-zinc-50 underline decoration-zinc-700 underline-offset-4"
                            : "text-zinc-500 hover:text-zinc-200",
                        ].join(" ")}
                      >
                        {page}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage >= totalPages}
                    className={[
                      "text-xs uppercase tracking-widest transition-colors",
                      currentPage >= totalPages
                        ? "cursor-not-allowed text-zinc-600"
                        : "text-zinc-500 hover:text-zinc-200",
                    ].join(" ")}
                  >
                    →
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>

      {isAboutOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-zinc-800 bg-[#0a0a0a] p-6 text-zinc-200">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm uppercase tracking-widest text-zinc-50">About Dépôt</h3>
              <button
                type="button"
                onClick={() => setIsAboutOpen(false)}
                className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Dépôt aggregates inventory from the best Paris archive and vintage
              stores into one editorial feed.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
