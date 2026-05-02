import { supabaseAdmin } from "../../lib/supabase.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const depth = parseInt(url.searchParams.get("depth") ?? "0", 10);

  const { count: remaining, error: countErr } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true })
    .or("brand.is.null,title.is.null");

  if (countErr) {
    return Response.json({ error: countErr.message }, { status: 500 });
  }

  return Response.json({
    skeleton: true,
    depth,
    remaining: remaining ?? 0,
  });
}
