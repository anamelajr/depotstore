import Image from "next/image";

const eyebrowCls =
  "font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";
const titleCls =
  "font-sans font-normal leading-[1.0] tracking-[-0.03em] text-zinc-950";
const subtitleCls =
  "font-mono text-[11px] leading-[1.6] text-zinc-700 whitespace-pre-line";
const bylineCls = "font-mono text-[9px] text-zinc-500";

// `relative` is not decoration: a `fill` image is absolutely positioned, so
// without a positioned ancestor it escapes the aspect box and sizes itself
// against the page. It is part of the conversion, not optional.
//
// `sizes` is threaded per layout rather than defaulted — a wrong `sizes` on a
// fill image is the difference between shipping a half-width derivative and
// shipping the full-width one.
function HeroImage({ src, slug, alt, ratio = "aspect-[4/5]", sizes = "100vw" }) {
  return (
    <div className={`relative ${ratio} w-full overflow-hidden bg-zinc-900`}>
      <Image
        src={`/editorial/${slug}/${src}`}
        alt={alt || ""}
        fill
        sizes={sizes}
        priority
        className="object-cover"
      />
    </div>
  );
}

function HeroText({ hero, byline, date }) {
  return (
    <div className="flex flex-col gap-5">
      <div className={eyebrowCls}>{hero.eyebrow}</div>
      <h1 className={`${titleCls} text-[clamp(40px,6vw,72px)]`}>
        {hero.title}
      </h1>
      <div className={subtitleCls}>{hero.subtitle}</div>
      <div className={bylineCls}>
        {byline} &nbsp;·&nbsp; {date}
      </div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export default function EditorialHero({ entry }) {
  const { hero, slug, publishedAt } = entry;
  const date = formatDate(publishedAt);

  if (hero.layout === "image-right") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-8 md:gap-12 items-start">
          <div className="pt-2 md:pt-6">
            <HeroText hero={hero} byline={hero.byline} date={date} />
          </div>
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
            sizes="(min-width: 768px) 50vw, 100vw"
          />
        </div>
      </section>
    );
  }

  if (hero.layout === "image-left") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.05fr] gap-8 md:gap-12 items-start">
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
            sizes="(min-width: 768px) 50vw, 100vw"
          />
          <div className="pt-2 md:pt-6">
            <HeroText hero={hero} byline={hero.byline} date={date} />
          </div>
        </div>
      </section>
    );
  }

  if (hero.layout === "image-below") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="max-w-2xl mx-auto text-center mb-10 md:mb-14">
          <HeroText hero={hero} byline={hero.byline} date={date} />
        </div>
        <HeroImage
          slug={slug}
          src={hero.images[0]}
          alt={hero.imageAlt?.[0]}
          ratio="aspect-[16/9]"
          sizes="100vw"
        />
      </section>
    );
  }

  if (hero.layout === "image-pair-top") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-2 gap-3 md:gap-4 mb-8 md:mb-12">
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
            ratio="aspect-[3/4]"
            sizes="50vw"
          />
          <HeroImage
            slug={slug}
            src={hero.images[1]}
            alt={hero.imageAlt?.[1]}
            ratio="aspect-[3/4]"
            sizes="50vw"
          />
        </div>
        <div className="max-w-2xl">
          <HeroText hero={hero} byline={hero.byline} date={date} />
        </div>
      </section>
    );
  }

  // Unknown layout — render nothing so a typo doesn't crash the page.
  return null;
}
