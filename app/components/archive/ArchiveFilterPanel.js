"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { OptionRow } from "../MobileFilterPanel";
import { useLanguage } from "../LanguageProvider";

/**
 * Mobile filter panel for a featured archive.
 *
 * Same shell as MobileFilterPanel — full-screen portal, navMenuEnter, body
 * scroll lock, 50px header, 56px APPLY/RESET footer — but it opens straight
 * into the category list: an archive filters on one dimension, so the root
 * CATEGORY/STORE menu would be a screen with a single row on it.
 *
 * The atomic-commit invariant (CLAUDE.md) is preserved exactly: `draft` is
 * re-seeded from `selectedCategories` on every open, APPLY is the single
 * commit, RESET clears the draft without committing, and closing without APPLY
 * discards.
 */
export default function ArchiveFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  groups,
  onApply, // (categories: string[]) => void — the only commit path
}) {
  // Body scroll lock keyed on isOpen alone: this component stays mounted while
  // closed, so a dep on selectedCategories would re-run the closed branch on
  // every desktop-drawer toggle and clear the lock that drawer still holds.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (typeof document === "undefined") return null;
  if (!isOpen) return null;

  // The body remounts on every open, so its useState initializers re-seed the
  // draft from the committed selection without setState-in-effect.
  return (
    <ArchiveFilterPanelBody
      onClose={onClose}
      selectedCategories={selectedCategories}
      groups={groups}
      onApply={onApply}
    />
  );
}

function ArchiveFilterPanelBody({ onClose, selectedCategories, groups, onApply }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(selectedCategories);
  const [expanded, setExpanded] = useState(null); // group value or null

  const toggle = (value) => {
    setDraft((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white text-zinc-950 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("filter.filters").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>

      <div className="flex-1 px-8 pt-2 pb-20 overflow-y-auto">
        {groups.map((group) =>
          group.children ? (
            <div key={group.value}>
              <button
                onClick={() => setExpanded(expanded === group.value ? null : group.value)}
                className="flex items-center justify-between w-full py-4 border-b border-zinc-200 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
              >
                <span>{group.label.toUpperCase()}</span>
                <span className="text-zinc-950 text-[15px] font-extralight leading-none">
                  {expanded === group.value ? "−" : "+"}
                </span>
              </button>
              {expanded === group.value && (
                <div className="py-3 flex flex-col gap-3 border-b border-zinc-200">
                  {group.children.map((child) => (
                    <OptionRow
                      key={child.value}
                      label={child.label}
                      checked={draft.includes(child.value)}
                      onChange={() => toggle(child.value)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Leaf category — no sub-menu to expand into, so the row is the
            // checkbox itself rather than a dead expander.
            <div
              key={group.value}
              className="flex items-center py-4 border-b border-zinc-200"
            >
              <OptionRow
                label={group.label.toUpperCase()}
                checked={draft.includes(group.value)}
                onChange={() => toggle(group.value)}
              />
            </div>
          )
        )}
      </div>

      <footer className="absolute bottom-0 left-0 right-0 h-14 grid grid-cols-2 bg-white/95 backdrop-blur border-t border-zinc-200">
        <button
          onClick={() => setDraft([])}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-500 border-r border-zinc-200"
        >
          {t("filter.reset").toUpperCase()}
        </button>
        <button
          onClick={handleApply}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
        >
          {t("filter.apply").toUpperCase()}{draft.length > 0 ? ` (${draft.length})` : ""}
        </button>
      </footer>
    </div>,
    document.body
  );
}
