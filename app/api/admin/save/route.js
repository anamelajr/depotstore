import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import { serializeEditorialModule } from "../../../lib/serializeEditorialModule.js";
import { patchEditorialIndex } from "../../../lib/patchEditorialIndex.js";

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const entry = body.entry;
  if (!entry || typeof entry !== "object") {
    return NextResponse.json({ error: "missing entry" }, { status: 400 });
  }

  const slug = entry.slug;
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const root = process.cwd();
  const slugFile = join(root, "content", "editorial", `${slug}.js`);
  const indexFile = join(root, "content", "editorial", "index.js");
  const imgDir = join(root, "public", "editorial", slug);

  let indexSource;
  try {
    indexSource = await fs.readFile(indexFile, "utf8");
  } catch (err) {
    return NextResponse.json(
      { error: `cannot read index.js: ${err.message}` },
      { status: 500 }
    );
  }

  let nextIndex;
  try {
    nextIndex = patchEditorialIndex(indexSource, slug);
  } catch (err) {
    return NextResponse.json(
      { error: `index.js patch failed: ${err.message}` },
      { status: 500 }
    );
  }

  // Serialize and write the slug file.
  let source;
  try {
    source = serializeEditorialModule(entry);
  } catch (err) {
    return NextResponse.json(
      { error: `serialize failed: ${err.message}` },
      { status: 500 }
    );
  }

  // Track whether the slug file existed before this save so we can roll
  // back cleanly on partial failure (orphan-slug-without-registry-entry).
  let slugFileExistedBefore = true;
  try {
    await fs.access(slugFile);
  } catch {
    slugFileExistedBefore = false;
  }

  try {
    await fs.writeFile(slugFile, source, "utf8");
  } catch (err) {
    return NextResponse.json(
      { error: `slug-file write failed: ${err.message}` },
      { status: 500 }
    );
  }

  if (nextIndex !== indexSource) {
    try {
      await fs.writeFile(indexFile, nextIndex, "utf8");
    } catch (err) {
      // Rollback: if we just created a brand-new slug file but failed to
      // update the registry, unlink the slug file so we don't leave an
      // orphan that fails public lookup but appears in /admin/editorial.
      // For existing entries we leave the slug file in place — the prior
      // content is already gone and the index entry already points at it.
      if (!slugFileExistedBefore) {
        await fs.unlink(slugFile).catch(() => {});
      }
      return NextResponse.json(
        {
          error: `index.js write failed (rolled back: ${!slugFileExistedBefore}): ${err.message}`,
        },
        { status: 500 }
      );
    }
  }

  try {
    await fs.mkdir(imgDir, { recursive: true });
  } catch {
    // Image dir creation failure is non-fatal — user can mkdir manually.
  }

  return NextResponse.json({
    ok: true,
    slugFile: `content/editorial/${slug}.js`,
    indexUpdated: nextIndex !== indexSource,
  });
}
