import Link from "next/link";
import Image from "next/image";

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export default function EditorialIndexCard({ entry }) {
  const { slug, hero, publishedAt } = entry;
  return (
    <Link
      href={`/editorial/${slug}`}
      className="block group"
    >
      {/* `relative` is required by `fill` — the image is absolutely
          positioned and would otherwise escape this aspect box. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-zinc-900">
        <Image
          src={`/editorial/${slug}/${hero.images[0]}`}
          alt={hero.imageAlt?.[0] || ""}
          fill
          // Reads off the index grid in app/editorial/page.js:
          // 1 col → 2 cols at md → 3 cols at lg.
          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.02]"
        />
      </div>
      <div className="mt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
          {hero.eyebrow}
        </div>
        <h2 className="mt-3 font-sans text-[28px] leading-[1.05] tracking-[-0.02em] text-zinc-950">
          {hero.title}
        </h2>
        {hero.subtitle ? (
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-zinc-700 whitespace-pre-line line-clamp-2">
            {hero.subtitle}
          </p>
        ) : null}
        <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
          {formatDate(publishedAt)}
        </div>
      </div>
    </Link>
  );
}
