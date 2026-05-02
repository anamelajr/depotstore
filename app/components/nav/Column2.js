"use client";

import SubcategoryList from "./SubcategoryList";
import DesignersPanel from "./DesignersPanel";
import StoresPanel from "./StoresPanel";

export default function Column2({ expandedKey, searchParams, stores = [] }) {
  if (!expandedKey) return <div className="px-8 py-8" />;

  if (expandedKey === "tops" || expandedKey === "jackets" || expandedKey === "bags") {
    return (
      <div className="border-l border-zinc-900 px-8 py-8">
        <SubcategoryList expandKey={expandedKey} searchParams={searchParams} />
      </div>
    );
  }

  if (expandedKey === "designers") {
    return (
      <div className="border-l border-zinc-900 px-8 py-8">
        <DesignersPanel searchParams={searchParams} />
      </div>
    );
  }

  if (expandedKey === "stores") {
    return (
      <div className="border-l border-zinc-900 px-8 py-8">
        <StoresPanel stores={stores} searchParams={searchParams} />
      </div>
    );
  }

  return <div className="border-l border-zinc-900 px-8 py-8" />;
}
