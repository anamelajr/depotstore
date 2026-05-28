import Link from "next/link";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import DeleteEntryButton from "./_components/DeleteEntryButton.js";
import PublishButton from "../_components/PublishButton.js";

async function loadEntries() {
  const dir = join(process.cwd(), "content", "editorial");
  const files = await fs.readdir(dir);
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".js") || file === "index.js") continue;
    const slug = file.replace(/\.js$/, "");
    try {
      const src = await fs.readFile(join(dir, file), "utf8");
      const fn = new Function(src.replace(/export default\s+(\w+)\s*;/, "return $1;"));
      const e = fn();
      entries.push({
        slug,
        title: e?.hero?.title ?? slug,
        publishedAt: e?.publishedAt ?? "",
      });
    } catch (err) {
      entries.push({ slug, title: slug, error: err.message });
    }
  }
  entries.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return entries;
}

export default async function EditorialList() {
  const entries = await loadEntries();
  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>Editorial entries</h1>
        <Link
          href="/admin/editorial/new"
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            background: "#d6d2c4",
            color: "#18181a",
            borderRadius: 4,
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          + New entry
        </Link>
        <PublishButton
          files={["content/editorial/", "public/editorial/"]}
          label="editorial"
        />
      </header>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {entries.map((e) => (
          <li key={e.slug} style={{ display: "flex", alignItems: "stretch" }}>
            <Link
              href={`/admin/editorial/${e.slug}`}
              style={{
                display: "flex",
                flex: 1,
                minWidth: 0,
                padding: 12,
                background: "#18181a",
                border: "1px solid #2a2a2c",
                borderRadius: 6,
                color: "#e7e7e2",
                textDecoration: "none",
              }}
            >
              <span style={{ fontWeight: 500 }}>{e.title}</span>
              <span style={{ marginLeft: 8, color: "#6b6b62", fontSize: 12 }}>
                /{e.slug}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>
                {e.publishedAt}
              </span>
            </Link>
            <DeleteEntryButton slug={e.slug} title={e.title} />
          </li>
        ))}
      </ul>
    </div>
  );
}
