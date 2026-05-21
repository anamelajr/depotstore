"use client";

// PreviewPane is a client component because the editor lifts state into
// React useState and PreviewPane needs to re-render on every keystroke.
// Block and EditorialHero are shared components (verified in Step 1) —
// importing them here causes Next.js to bundle them for the client.
// This is the supported pattern; only true server components (those that
// use cookies/headers/server-only) require the children-via-props
// composition trick.
import Block from "../../../../editorial/_components/Block.js";
import EditorialHero from "../../../../editorial/_components/EditorialHero.js";

export default function PreviewPane({ entry }) {
  if (!entry) return null;
  return (
    <div
      style={{
        background: "#f6f3ec",
        color: "#18181a",
        padding: 24,
        borderRadius: 6,
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
        position: "sticky",
        top: 80,
      }}
    >
      <EditorialHero entry={entry} />
      {(entry.blocks ?? []).map((block, i) => (
        <Block key={i} block={block} slug={entry.slug} />
      ))}
    </div>
  );
}
