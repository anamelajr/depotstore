"use client";

import { useState } from "react";
import HeroPanel from "./HeroPanel.js";
import CuratedProductsPanel from "./CuratedProductsPanel.js";
import BlockCard from "./BlockCard.js";
import AddBlockMenu from "./AddBlockMenu.js";
import PreviewPane from "./PreviewPane.js";
import GenerateModal from "./GenerateModal.js";
import PublishButton from "../../../_components/PublishButton.js";

function mergeGeneratedBlocks(currentBlocks, generatedBlocks, expectedTextCount) {
  const isImage = (b) => b.type === "image" || b.type === "image-pair";
  const imageSlots = currentBlocks.filter(isImage);
  const generatedTextish = generatedBlocks.filter((b) => !isImage(b));

  const segments = imageSlots.length + 1;

  if (
    typeof expectedTextCount === "number" &&
    generatedTextish.length !== expectedTextCount
  ) {
    return {
      merged: [...generatedTextish, ...imageSlots],
      warning:
        `GPT returned ${generatedTextish.length} text-shaped blocks; ` +
        `the structure plan asked for ${expectedTextCount}. ` +
        `Generated content placed before your image blocks instead of threaded around them. ` +
        `Drag blocks to rearrange, or regenerate.`,
    };
  }

  const perSegment = Math.max(1, Math.floor(generatedTextish.length / segments));
  const merged = [];
  let cursor = 0;
  for (let s = 0; s < segments; s++) {
    const isLast = s === segments - 1;
    const take = isLast ? generatedTextish.length - cursor : perSegment;
    merged.push(...generatedTextish.slice(cursor, cursor + take));
    cursor += take;
    if (!isLast) merged.push(imageSlots[s]);
  }
  return { merged, warning: null };
}

const EMPTY_ENTRY = {
  slug: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "",
    subtitle: "",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: [""],
  },
  brandFilter: "",
  curatedProducts: [],
  blocks: [],
};

export default function Editor({ initialEntry, slug }) {
  const isNew = slug === "new";
  const [entry, setEntry] = useState(
    initialEntry ?? { ...EMPTY_ENTRY, slug: "" }
  );
  const [draftSlug, setDraftSlug] = useState(entry.slug || "");
  const effectiveSlug = isNew ? draftSlug : slug;

  function updateHero(hero) { setEntry({ ...entry, hero }); }
  function updateBrand(brandFilter) { setEntry({ ...entry, brandFilter }); }
  function updatePublishedAt(publishedAt) { setEntry({ ...entry, publishedAt }); }
  function updateCurated(curatedProducts) { setEntry({ ...entry, curatedProducts }); }
  function updateBlock(i, next) {
    const blocks = entry.blocks.slice();
    blocks[i] = next;
    setEntry({ ...entry, blocks });
  }
  function deleteBlock(i) {
    setEntry({ ...entry, blocks: entry.blocks.filter((_, j) => j !== i) });
  }
  function moveBlock(i, dir) {
    const blocks = entry.blocks.slice();
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    setEntry({ ...entry, blocks });
  }
  function addBlock(block) {
    setEntry({ ...entry, blocks: [...entry.blocks, block] });
  }

  const [showGenerate, setShowGenerate] = useState(false);

  function applyGenerated({ hero, generatedBlocks, expectedTextCount }) {
    const { merged, warning } = mergeGeneratedBlocks(
      entry.blocks,
      generatedBlocks,
      expectedTextCount
    );
    setEntry({
      ...entry,
      hero: hero
        ? {
            ...entry.hero,
            eyebrow: hero.eyebrow ?? entry.hero.eyebrow,
            title: hero.title ?? entry.hero.title,
            subtitle: hero.subtitle ?? entry.hero.subtitle,
            byline: hero.byline ?? entry.hero.byline,
            imageAlt: hero.imageAlt ?? entry.hero.imageAlt,
          }
        : entry.hero,
      blocks: merged,
    });
    if (warning) {
      alert(warning);
    }
  }

  async function handleSave() {
    if (!effectiveSlug || !/^[a-z0-9][a-z0-9-]*$/.test(effectiveSlug)) {
      alert("Slug is required and must be kebab-case.");
      return;
    }
    if (/^\d/.test(effectiveSlug)) {
      alert("Slug cannot start with a digit — prefix with a letter (e.g., \"y2026-archive\").");
      return;
    }
    const payload = { ...entry, slug: effectiveSlug };
    const res = await fetch("/api/admin/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`Save failed: ${data.error || res.status}`);
      return;
    }
    alert(`Saved ${data.slugFile}${data.indexUpdated ? " (+ index.js)" : ""}`);
    if (isNew) {
      window.location.href = `/admin/editorial/${effectiveSlug}`;
    }
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <a href="/admin/editorial" style={{ color: "#b6b6ad", fontSize: 12, textDecoration: "none" }}>
          ← Editorial list
        </a>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>
          {effectiveSlug ? `content/editorial/${effectiveSlug}.js` : "(unsaved)"}
        </span>
        <button
          onClick={() => setShowGenerate(true)}
          style={{
            background: "linear-gradient(135deg, #6a4ba6, #4a3578)",
            color: "#fff",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            marginRight: 6,
          }}
        >
          ✦ Generate draft
        </button>
        <button
          onClick={handleSave}
          style={{
            background: "#d6d2c4",
            color: "#18181a",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Save
        </button>
        <PublishButton
          files={effectiveSlug ? [`content/editorial/${effectiveSlug}.js`, "content/editorial/index.js", `public/editorial/${effectiveSlug}/`] : []}
          label={effectiveSlug}
          disabled={!effectiveSlug}
        />
      </header>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(420px, 1fr) 1fr",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div style={{ maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
        {isNew && (
          <section
            style={{
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              padding: 14,
              marginBottom: 12,
            }}
          >
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80" }}>
                Slug (kebab-case, locked after first save)
              </span>
              <input
                value={draftSlug}
                onChange={(e) => setDraftSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="e.g. yohji-yamamoto"
                style={{
                  marginTop: 4,
                  width: "100%",
                  background: "#0f0f10",
                  border: "1px solid #2a2a2c",
                  color: "#e7e7e2",
                  padding: "6px 8px",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
            </label>
          </section>
        )}

        <HeroPanel
          hero={entry.hero}
          onChange={updateHero}
          slug={effectiveSlug || "(slug)"}
          brandFilter={entry.brandFilter}
          onBrandFilterChange={updateBrand}
          publishedAt={entry.publishedAt}
          onPublishedAtChange={updatePublishedAt}
        />

        <CuratedProductsPanel
          curatedProducts={entry.curatedProducts}
          onChange={updateCurated}
        />

        <section
          style={{
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 6,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
            Blocks ({entry.blocks.length})
          </h3>
          {entry.blocks.map((block, i) => (
            <BlockCard
              key={i}
              block={block}
              index={i}
              total={entry.blocks.length}
              slug={effectiveSlug}
              onChange={(next) => updateBlock(i, next)}
              onMoveUp={() => moveBlock(i, -1)}
              onMoveDown={() => moveBlock(i, +1)}
              onDelete={() => deleteBlock(i)}
            />
          ))}
          <AddBlockMenu onAdd={addBlock} />
        </section>
      </div>

      <PreviewPane entry={{ ...entry, slug: effectiveSlug }} />
    </div>
        {showGenerate && (
          <GenerateModal
            entry={{ ...entry, slug: effectiveSlug }}
            onClose={() => setShowGenerate(false)}
            onApply={applyGenerated}
          />
        )}
    </div>
  );
}
