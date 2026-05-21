// Pretty-prints an editorial entry object into a JS source string suitable
// for content/editorial/<slug>.js. Mirrors the format hand-authored
// rick-owens.js uses (2-space indent, trailing commas inside arrays/objects).
function serialize(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad2 = "  ".repeat(indent + 1);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    // JSON.stringify gives us proper escaping; replace double-escaped \n.
    return JSON.stringify(value).replace(/\\\\n/g, "\\n");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad2}${serialize(v, indent + 1)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const lines = keys.map((k) => `${pad2}${k}: ${serialize(value[k], indent + 1)}`);
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }
  return JSON.stringify(value);
}

export function serializeEditorialModule(entry) {
  const ordered = {
    slug: entry.slug,
    publishedAt: entry.publishedAt,
    hero: entry.hero,
    brandFilter: entry.brandFilter,
    curatedProducts: entry.curatedProducts ?? [],
    blocks: entry.blocks ?? [],
  };
  return `const entry = ${serialize(ordered, 0)};\n\nexport default entry;\n`;
}
