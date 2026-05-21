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
