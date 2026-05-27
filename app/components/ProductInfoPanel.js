export default function ProductInfoPanel({
  storeName,
  title,
  price,
  sizes,
  available,
  storeDomain,
  handle,
}) {
  const ctaHref = `https://${storeDomain}/products/${handle}?utm_source=depot`;
  const ctaText = available
    ? `BUY AT ${storeName.toUpperCase()}`
    : `VIEW ON ${storeName.toUpperCase()}`;

  const hasSizes = sizes && sizes.length > 0;
  const sizeLabel = hasSizes && sizes.length > 1 ? "SIZES" : "SIZE";
  const sizeValue = hasSizes ? sizes.join(" · ") : null;

  return (
    <div className="hidden lg:block lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:pt-6">
      {/* Store name */}
      <div className="border-b border-zinc-200 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          {storeName}
        </p>
        <h1 className="mt-3 font-sans text-[14px] font-medium uppercase tracking-[0.06em] leading-[1.45] text-zinc-900">
          {title}
        </h1>
      </div>

      {/* Price */}
      {price && (
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="font-mono text-[13px] text-zinc-700">{price}</p>
        </div>
      )}

      {/* Sizes */}
      {hasSizes && (
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
            {sizeLabel}
          </p>
          <p className="mt-1.5 font-mono text-[12px] uppercase tracking-[0.18em] text-zinc-700">
            {sizeValue}
          </p>
        </div>
      )}

      {/* CTA */}
      <div className="mt-6">
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-black hover:bg-zinc-800 text-white text-center py-4 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {ctaText}
        </a>
      </div>

      {/* Availability */}
      <div className="mt-3 flex items-center gap-2">
        <span
          className={`block h-1.5 w-1.5 rounded-full flex-none ${
            available ? "bg-emerald-500" : "bg-zinc-400"
          }`}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {available ? "Available" : "Sold"}
        </span>
      </div>
    </div>
  );
}
