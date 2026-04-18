"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function BackToFeedLink({ className }) {
  const [feedUrl, setFeedUrl] = useState("/feed");

  useEffect(() => {
    const saved = sessionStorage.getItem("depot_feed_url");
    if (saved) setFeedUrl(saved);
  }, []);

  return (
    <Link href={feedUrl} className={className}>
      &larr; Back
    </Link>
  );
}
