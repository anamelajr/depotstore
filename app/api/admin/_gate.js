import { NextResponse } from "next/server";

// Per-route guard. Middleware already blocks /api/admin/* in production,
// but every route also calls assertDev() — defense in depth, and a
// clearer error if middleware is misconfigured.
export function assertDev() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  return null;
}
