import { Suspense } from "react";
import FeedClient from "./FeedClient";
import { getActiveStores } from "../lib/stores.js";

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const stores = await getActiveStores();
  return (
    <Suspense fallback={null}>
      <FeedClient stores={stores} />
    </Suspense>
  );
}
