"use client";

import SubcategoryList from "./SubcategoryList";

export default function Column2({ expandedKey, searchParams, stores = [] }) {
  if (!expandedKey) return <div className="px-8 py-8" />;

  if (expandedKey === "tops" || expandedKey === "jackets" || expandedKey === "bags") {
    return (
      <div className="border-l border-zinc-900 px-8 py-8">
        <SubcategoryList expandKey={expandedKey} searchParams={searchParams} />
      </div>
    );
  }

  // designers + stores wired in Task 7 + 8
  return <div className="border-l border-zinc-900 px-8 py-8" />;
}
