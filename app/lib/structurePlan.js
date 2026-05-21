const LENGTH_TARGETS = {
  short:  { textBlockCount: 4,  words: 400  },
  medium: { textBlockCount: 6,  words: 800  },
  long:   { textBlockCount: 9,  words: 1500 },
};

function isImageBlock(b) {
  return b.type === "image" || b.type === "image-pair";
}

export function buildStructurePlan({ currentBlocks = [], length = "medium" }) {
  const target = LENGTH_TARGETS[length] || LENGTH_TARGETS.medium;
  const textBlockCount = target.textBlockCount;

  const imageBlocks = currentBlocks.filter(isImageBlock);
  const segments = imageBlocks.length + 1;
  const blocksPerSegment = Math.max(1, Math.floor(textBlockCount / segments));
  const wordsPerBlock = Math.round(target.words / textBlockCount);

  const lines = [];
  let textIdx = 0;
  let remaining = textBlockCount;
  for (let s = 0; s < segments; s++) {
    const isLast = s === segments - 1;
    const count = isLast ? remaining : Math.min(remaining, blocksPerSegment);
    for (let i = 0; i < count; i++) {
      textIdx += 1;
      const isOpening = textIdx === 1;
      const role = isOpening
        ? "opening paragraph (apply dropcap on this block only)"
        : "continues the section";
      lines.push(`  ${textIdx}. text — ~${wordsPerBlock} words, ${role}`);
      remaining -= 1;
    }
    if (!isLast) {
      const img = imageBlocks[s];
      const desc =
        img.type === "image-pair"
          ? "image-pair (two images side by side)"
          : `image (${img.width || "wide"})`;
      lines.push(`  -- IMAGE BREAK -- ${desc} -- the next text block starts a NEW thought, never continues the previous one.`);
    }
  }

  const hint =
    "Sprinkle 1-2 section-heading blocks and exactly 1 pullquote block into the text sequence above where they fit naturally. Keep the total text-shaped block count at " +
    `${textBlockCount} (text + section-heading + pullquote combined). Each block must end on a complete sentence and a complete thought.`;

  const plan = lines.join("\n") + "\n\n" + hint;
  return { plan, textBlockCount, targetWords: target.words };
}
