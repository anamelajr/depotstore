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

// Strict-mode reserved words can't be used as import bindings. ESM is
// always strict, so the slug-to-identifier output must avoid all of these
// AND start with a letter/$/_ (not a digit).
const RESERVED_IDENTIFIERS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield",
  "let", "static", "implements", "interface", "package", "private",
  "protected", "public", "await", "async", "arguments", "eval",
]);

export function isValidIdentifier(ident) {
  if (typeof ident !== "string" || ident.length === 0) return false;
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) return false;
  if (RESERVED_IDENTIFIERS.has(ident)) return false;
  return true;
}

export function patchEditorialIndex(source, slug) {
  const ident = slugToIdentifier(slug);
  if (!isValidIdentifier(ident)) {
    throw new Error(
      `patchEditorialIndex: slug "${slug}" produces invalid JS identifier "${ident}"`
    );
  }
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

// Counterpart to patchEditorialIndex: removes an entry's registration from
// content/editorial/index.js. The import line and the ENTRIES identifier are
// removed INDEPENDENTLY — the dangerous one-sided state (import gone but
// ENTRIES still references the identifier) already throws a ReferenceError on
// load, and is reachable through manual editing, so this helper must repair it
// rather than no-op on it. Idempotent only when BOTH are already absent.
export function unpatchEditorialIndex(source, slug) {
  const ident = slugToIdentifier(slug);
  const importLine = `import ${ident} from "./${slug}.js";`;

  // ENTRIES anchor must exist — mirrors add-path; route catches the throw.
  const entriesRe = /const ENTRIES = \[([^\]]*)\];/;
  const match = source.match(entriesRe);
  if (!match) {
    throw new Error(
      "unpatchEditorialIndex: could not locate `const ENTRIES = [...]` anchor"
    );
  }

  const importPresent = source.includes(importLine);
  const items = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const identPresent = items.includes(ident);

  // Idempotent no-op only when neither part references the entry.
  if (!importPresent && !identPresent) {
    return source;
  }

  let next = source;

  // Remove the import line and its trailing newline (if present).
  if (importPresent) {
    next = next.replace(`${importLine}\n`, "");
    // Fallback if the import was the last line with no trailing newline.
    next = next.replace(importLine, "");
  }

  // Remove the identifier from ENTRIES (exact-match, not substring).
  if (identPresent) {
    const newInner = items.filter((item) => item !== ident).join(", ");
    next = next.replace(entriesRe, `const ENTRIES = [${newInner}];`);
  }

  return next;
}
