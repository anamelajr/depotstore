import Link from "next/link";
import { buildFreshFeedUrl } from "../lib/feed-utils.js";

export default function ProductBreadcrumb({ brand, title }) {
  const sep = <span className="mx-1.5 text-zinc-400">/</span>;

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden lg:flex items-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400"
    >
      <Link href="/" className="hover:text-zinc-900 transition-colors">
        Home
      </Link>
      {brand && (
        <>
          {sep}
          <Link
            href={buildFreshFeedUrl({ brand })}
            className="hover:text-zinc-900 transition-colors"
          >
            {brand}
          </Link>
        </>
      )}
      {sep}
      <span className="text-zinc-900 truncate max-w-[280px]">{title}</span>
    </nav>
  );
}
