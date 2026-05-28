import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import { unpatchEditorialIndex } from "../../../lib/patchEditorialIndex.js";

// Atomically write `contents` to `file` via tmp + rename so a mid-write
// interruption never leaves a truncated index.js (the save-homepage-edit
// pattern). Cleans up the tmp file on failure.
async function atomicWrite(file, contents) {
  const tmpFile = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    await fs.writeFile(tmpFile, contents, "utf8");
    await fs.rename(tmpFile, file);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }
}

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const slug = body.slug;
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const root = process.cwd();
  const slugFile = join(root, "content", "editorial", `${slug}.js`);
  const indexFile = join(root, "content", "editorial", "index.js");
  const imgDir = join(root, "public", "editorial", slug);

  // slug "index" resolves slugFile to the registry itself — never unlink it.
  if (slugFile === indexFile) {
    return NextResponse.json(
      { error: "refusing to delete the editorial registry (reserved slug)" },
      { status: 400 }
    );
  }

  // Step 1: read + unpatch index.js, write atomically. Keep the original in
  // memory for rollback if the slug-file deletion later fails.
  let originalIndex;
  try {
    originalIndex = await fs.readFile(indexFile, "utf8");
  } catch (err) {
    return NextResponse.json(
      { error: `cannot read index.js: ${err.message}` },
      { status: 500 }
    );
  }

  let nextIndex;
  try {
    nextIndex = unpatchEditorialIndex(originalIndex, slug);
  } catch (err) {
    return NextResponse.json(
      { error: `index.js unpatch failed: ${err.message}` },
      { status: 500 }
    );
  }

  const indexUpdated = nextIndex !== originalIndex;
  if (indexUpdated) {
    try {
      await atomicWrite(indexFile, nextIndex);
    } catch (err) {
      return NextResponse.json(
        { error: `index.js write failed: ${err.message}` },
        { status: 500 }
      );
    }
  }

  // Step 2: delete the slug file. ENOENT is benign (already gone). Any other
  // error is blocking — roll index.js back so we never leave a partial delete
  // (the entry would vanish from the public registry while still listed in
  // admin, and the dirty index.js could be published as a silent partial).
  try {
    await fs.unlink(slugFile);
  } catch (err) {
    if (err.code !== "ENOENT") {
      if (indexUpdated) {
        await atomicWrite(indexFile, originalIndex).catch(() => {});
      }
      return NextResponse.json(
        { error: `slug-file delete failed (index rolled back): ${err.message}` },
        { status: 500 }
      );
    }
  }

  // Step 3: best-effort image cleanup. The actual intent (registry + slug
  // file) already succeeded, so a failure here is a soft warning, not an
  // error — but report it honestly so orphaned assets aren't hidden.
  let imagesRemoved = true;
  try {
    await fs.rm(imgDir, { recursive: true, force: true });
  } catch {
    imagesRemoved = false;
  }

  return NextResponse.json({ ok: true, slug, indexUpdated, imagesRemoved });
}
