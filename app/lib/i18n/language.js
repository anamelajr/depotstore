import { cookies } from "next/headers";

export const ALLOWED_LANGUAGES = ["en", "fr"];

// Server-side language resolver — reads and validates the depot_lang cookie.
// Defaults to "en" for cookieless visitors.
// Use ONLY for: generateMetadata and the initial <html lang> seed in layout.js.
// Everything else resolves language via LanguageProvider context + <T> leaves.
export async function getLanguage() {
  const cookieLang = (await cookies()).get("depot_lang")?.value;
  return ALLOWED_LANGUAGES.includes(cookieLang) ? cookieLang : "en";
}
