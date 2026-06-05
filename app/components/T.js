"use client";

import { useLanguage } from "./LanguageProvider";

// Text leaf — the client analogue of <Price>.
// Lets a server component emit a translatable string that swaps live on
// language toggle via context, with no server re-render.
// Usage: <T k="nav.menu" />
export default function T({ k }) {
  const { t } = useLanguage();
  return t(k);
}
