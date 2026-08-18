"use client";

import { track } from "@vercel/analytics";
import PrefetchLink from "./PrefetchLink.js";
import HoverSwapImage from "./HoverSwapImage.js";
import Price from "./Price.js";
import { useLanguage } from "./LanguageProvider";
import {
  pdpSlide1Src,
  pdpSlide1SrcSet,
  PDP_SLIDE1_SIZES,
} from "../lib/shopifyImage.js";

// `priority` is passed straight through to HoverSwapImage: false for the vast
// majority of cards, "eager"/"high" for the handful a grid renders above the
// fold. See HoverSwapImage for what each tier does.
export default function ProductCard({ product, imageSizes, priority = false }) {
  const { t } = useLanguage();
  const {
    name,
    title,
    brand,
    price: rawPrice,
    imageUrl,
    imageUrl2,
    storeName,
    productUrl,
    available,
    handle,
    storeDomain,
  } = product ?? {};
  const SHORT_NAMES = {
    "Les Archives Paris": "Les Archives",
    "Numero 13 Vintage": "Numero 13",
    "Chez Snow Bunny": "Snow Bunny",
  };
  const SHORT_BRANDS = {
    "COMME DES GARÇONS HOMME PLUS": "CDG Homme Plus",
    "COMME DES GARCONS HOMME PLUS": "CDG Homme Plus",
    "JUNYA WATANABE COMME DES GARÇONS": "JUNYA WATANABE CDG",
  };
  const badgeName = SHORT_NAMES[storeName] ?? storeName;
  const displayBrand = brand ? (SHORT_BRANDS[brand] ?? brand) : null;
  const displayTitle = title ?? name ?? t("product.untitled");
  const isSold = !available;

  // No `&available=` here any more: nothing ever read it, and it fragmented
  // the prefetch key — a sold-out flip between hover and click would have
  // wasted the warmed route entry.
  const internalUrl = handle && storeDomain
    ? `/product/${handle}?store=${storeDomain}`
    : null;

  const handleClick = () => {
    track("product_click", {
      storeName: storeName ?? null,
      productName: displayTitle ?? null,
      productUrl: productUrl ?? null,
    });
  };

  const card = (
    <div className="group flex h-full flex-col focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300">
      {/* Image */}
      <div className="relative aspect-[4/5] shrink-0 overflow-hidden bg-zinc-100">
        {imageUrl ? (
          // Keyed on the image URLs, not just the card's own identity: feed
          // cards are keyed by productUrl + name, so a product whose photos
          // change in place would keep the old loaded/loaded2/primed state and
          // skip the fade and hover gates for the new images.
          <HoverSwapImage
            key={`${imageUrl}|${imageUrl2 ?? ""}`}
            imageUrl={imageUrl}
            imageUrl2={imageUrl2}
            alt={displayTitle}
            sizes={imageSizes}
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 text-xs text-zinc-400">
            {t("product.noImage")}
          </div>
        )}
        {isSold ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <div className="text-[11px] font-mono uppercase tracking-widest text-white">
              {t("product.sold")}
            </div>
          </div>
        ) : null}
      </div>

      {/* Info */}
      <div className="mt-4 flex flex-1 flex-col">
        {/* Mobile */}
        <div className="flex flex-1 flex-col md:hidden">
          <div>
            {brand ? (
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-950">
                {displayBrand}
              </div>
            ) : null}
            <div className={`font-sans text-[13px] leading-snug text-zinc-600 line-clamp-2 min-h-[2lh]${brand ? " mt-0.5" : ""}`}>
              {displayTitle}
            </div>
          </div>
          <div className="mt-auto flex items-baseline justify-between gap-2 pt-2">
            <Price eur={rawPrice} className="font-mono text-[12px] text-zinc-800" />
            {storeName ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
                {badgeName}
              </span>
            ) : null}
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex md:justify-between md:gap-4">
          <div className="flex flex-col min-w-0">
            {brand ? (
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-950">
                {displayBrand}
              </div>
            ) : null}
            <div className={`font-sans text-[13px] leading-snug text-zinc-600 line-clamp-2${brand ? " mt-0.5" : ""}`}>
              {displayTitle}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between">
            <Price eur={rawPrice} className="font-mono text-[12px] text-zinc-800 whitespace-nowrap" />
            {storeName ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
                {badgeName}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (!internalUrl) return card;

  return (
    <PrefetchLink
      href={internalUrl}
      // Must stay byte-identical to the PDP hero's own src/srcSet/sizes (all
      // three read the same contract) or the warm fetches a candidate the
      // product page never asks for and the click pays twice.
      heroImage={
        imageUrl
          ? {
              src: pdpSlide1Src(imageUrl),
              srcSet: pdpSlide1SrcSet(imageUrl),
              sizes: PDP_SLIDE1_SIZES,
            }
          : null
      }
      className="block h-full focus:outline-none"
      onClick={handleClick}
    >
      {card}
    </PrefetchLink>
  );
}