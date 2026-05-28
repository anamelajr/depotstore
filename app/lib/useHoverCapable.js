"use client";
import { useEffect, useState } from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

export function useHoverCapable() {
  // Must start false so SSR and first client paint agree (no hydration mismatch).
  // Image 2 is decorative, so deferring its mount to post-hydration on desktop is fine.
  const [hoverCapable, setHoverCapable] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setHoverCapable(mql.matches);
    update();
    mql.addEventListener("change", update); // handles tablet + mouse plugged in/out
    return () => mql.removeEventListener("change", update);
  }, []);
  return hoverCapable;
}
