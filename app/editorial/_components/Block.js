import Image from "next/image";

function paragraphs(body) {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function TextBlock({ block }) {
  const widthCls = block.width === "wide" ? "max-w-3xl" : "max-w-[56ch]";
  const dropcapCls = block.dropcap
    ? "first-letter:font-serif first-letter:text-[4.2em] first-letter:leading-[0.85] first-letter:float-left first-letter:pr-3 first-letter:pt-1"
    : "";
  const paras = paragraphs(block.body);
  return (
    <div className={`mx-auto ${widthCls} font-sans text-[16px] leading-[1.7] text-zinc-800`}>
      {paras.map((p, i) => (
        <p key={i} className={i === 0 ? dropcapCls : ""}>
          {p}
        </p>
      ))}
    </div>
  );
}

function SectionHeadingBlock({ block }) {
  return (
    <div className="mx-auto max-w-[56ch] pt-4">
      <div className="border-t border-zinc-900/20 pt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950">
        {block.text}
      </div>
    </div>
  );
}

function ImageBlock({ block, slug }) {
  const src = `/editorial/${slug}/${block.src}`;
  const wrapperCls =
    block.width === "full-bleed"
      ? "w-full"
      : block.width === "wide"
        ? "max-w-3xl mx-auto"
        : "max-w-xl mx-auto";
  // The big one: these are the raw full-bleed article photos, the real bytes
  // and CLS offender on an editorial page.
  //
  // next/image needs intrinsic dimensions, and the block schema didn't carry
  // any. Rather than force every future block to declare them, `w`/`h` are
  // OPTIONAL: present → an optimized, correctly-reserved <Image>; absent →
  // today's <img>, verbatim, so dimension-less content keeps working exactly
  // as it does now. The schema stays additive, which also leaves admin's
  // fs + new Function reads untouched.
  const sizes =
    block.width === "full-bleed"
      ? "100vw"
      : block.width === "wide"
        ? "(min-width: 768px) 768px, 100vw"
        : "(min-width: 640px) 576px, 100vw";
  return (
    <figure className={wrapperCls}>
      <div className="w-full overflow-hidden bg-zinc-900">
        {block.w && block.h ? (
          <Image
            src={src}
            alt={block.alt || ""}
            width={block.w}
            height={block.h}
            sizes={sizes}
            loading="lazy"
            className="block w-full h-auto"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- deliberate:
          // without intrinsic dimensions next/image can't reserve a box, and
          // this branch exists to keep dimension-less content rendering
          // exactly as it does today.
          <img
            src={src}
            alt={block.alt || ""}
            className="block w-full h-auto"
            loading="lazy"
          />
        )}
      </div>
      {block.caption ? (
        <figcaption className="mt-2 font-mono text-[10px] text-zinc-600 tracking-[0.05em] px-1">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function PullquoteBlock({ block }) {
  return (
    <blockquote className="mx-auto max-w-[42ch] border-l-2 border-zinc-950 pl-5 font-serif italic text-[26px] leading-[1.25] text-zinc-950">
      &ldquo;{block.text}&rdquo;
      {block.attribution ? (
        <div className="mt-3 font-mono not-italic text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          — {block.attribution}
        </div>
      ) : null}
    </blockquote>
  );
}

function ImagePairBlock({ block, slug }) {
  return (
    <div className="mx-auto max-w-3xl grid grid-cols-2 gap-3 md:gap-4">
      {block.images.map((img, i) => (
        // `relative` is required by `fill`: the image is absolutely
        // positioned and escapes this aspect box without it.
        <div key={i} className="relative aspect-[4/5] overflow-hidden bg-zinc-900">
          <Image
            src={`/editorial/${slug}/${img.src}`}
            alt={img.alt || ""}
            fill
            // Half of the max-w-3xl (768px) grid, minus the gap, until the
            // viewport is narrower than the container.
            sizes="(min-width: 768px) 376px, 50vw"
            loading="lazy"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

export default function Block({ block, slug }) {
  switch (block.type) {
    case "text":          return <TextBlock block={block} />;
    case "section-heading": return <SectionHeadingBlock block={block} />;
    case "image":         return <ImageBlock block={block} slug={slug} />;
    case "pullquote":     return <PullquoteBlock block={block} />;
    case "image-pair":    return <ImagePairBlock block={block} slug={slug} />;
    default:              return null;
  }
}
