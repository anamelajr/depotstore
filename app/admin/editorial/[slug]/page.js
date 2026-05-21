import { promises as fs } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import PreviewPane from "./_components/PreviewPane.js";
import Editor from "./_components/Editor.js";

async function loadEntry(slug) {
  if (slug === "new") return null;
  const file = join(process.cwd(), "content", "editorial", `${slug}.js`);
  try {
    const src = await fs.readFile(file, "utf8");
    const fn = new Function(src.replace(/export default\s+(\w+)\s*;/, "return $1;"));
    return fn();
  } catch {
    return null;
  }
}

export default async function EditorialEditor({ params }) {
  const { slug } = await params;
  const entry = await loadEntry(slug);
  if (slug !== "new" && !entry) notFound();

  return <Editor initialEntry={entry} slug={slug} />;
}
