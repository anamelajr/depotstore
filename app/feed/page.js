import { Suspense } from "react";
import FeedClient from "./FeedClient";

export const revalidate = 3600;

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

export default async function FeedPage() {
  const products = await getProducts();
  return (
    <Suspense fallback={null}>
      <FeedClient products={products} />
    </Suspense>
  );
}