import { NextResponse } from "next/server";

// Local-only admin tool: every /admin and /api/admin route returns 404
// in production builds. Runs only during `npm run dev` (NODE_ENV=development).
export function middleware(request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
