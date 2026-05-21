// Idempotently inserts a new entry into content/editorial/index.js.
// Anchored regex against the stable shape of that file:
//   import xxx from "./xxx.js";   ← we add ours after the last one
//   const ENTRIES = [...];        ← we push our identifier into this array
//
// Returns the new file source. Throws if anchors are missing — the save
// route catches the throw, abandons the write, and surfaces the error.

export function slugToIdentifier(slug) {
  return slug
    .split("-")
    .map((part, i) =>
      i === 0
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("");
}

export function patchEditorialIndex(source, slug) {
  const ident = slugToIdentifier(slug);
  const importLine = `import ${ident} from "./${slug}.js";`;

  // Idempotent — bail if the import already exists.
  if (source.includes(importLine)) {
    return source;
  }

  // Validate anchors exist before making changes.
  const entriesRe = /const ENTRIES = \[([^\]]*)\];/;
  if (!entriesRe.test(source)) {
    throw new Error(
      "patchEditorialIndex: could not locate `const ENTRIES = [...]` anchor"
    );
  }

  // 1. Insert import after the last existing import line.
  const lines = source.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ")) lastImportIdx = i;
  }
  if (lastImportIdx === -1) {
    throw new Error(
      "patchEditorialIndex: no existing import line found in index.js"
    );
  }
  lines.splice(lastImportIdx + 1, 0, importLine);

  // 2. Push identifier into ENTRIES array.
  const joined = lines.join("\n");
  const match = joined.match(entriesRe);
  const inner = match[1].trim();
  const newInner = inner ? `${inner}, ${ident}` : ident;
  return joined.replace(entriesRe, `const ENTRIES = [${newInner}];`);
}
