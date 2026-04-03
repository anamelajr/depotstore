import { Suspense } from "react";
import FeedClient from "./FeedClient";

export const dynamic = 'force-dynamic';

export default function FeedPage() {
  return (
    <Suspense fallback={null}>
      <FeedClient />
    </Suspense>
  );
}
