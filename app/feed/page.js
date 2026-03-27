import { Suspense } from "react";
import FeedClient from "./FeedClient";

export const revalidate = 300;

async function getProducts() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://depotstore-tau.vercel.app";
    const res = await fetch(`${baseUrl}/api/products`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default async function FeedPage({ searchParams }) {
  const products = await getProducts();
  const params = await searchParams;
  
  // Build a key from category and store params
  // When these change, FeedClient fully remounts with fresh local state
  const categories = Array.isArray(params?.category)
    ? params.category
    : params?.category
    ? [params.category]
    : [];
  const store = params?.store || "";
  const feedKey = [...categories].sort().join(",") + "|" + store;

  return (
    <Suspense fallback={null}>
      <FeedClient key={feedKey} products={products} />
    </Suspense>
  );
}