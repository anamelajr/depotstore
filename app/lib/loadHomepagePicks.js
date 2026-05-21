import { promises as fs } from "node:fs";
import { join } from "node:path";

const PICKS_FILE = join(process.cwd(), "content", "homepage-edit.json");

export async function loadHomepagePicks() {
  let raw;
  try {
    raw = await fs.readFile(PICKS_FILE, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[loadHomepagePicks] read failed: ${err.message}`);
    }
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[loadHomepagePicks] JSON.parse failed: ${err.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn("[loadHomepagePicks] expected array, got", typeof parsed);
    return [];
  }

  return parsed.filter(
    (p) =>
      p &&
      typeof p.storeDomain === "string" &&
      typeof p.handle === "string"
  );
}
