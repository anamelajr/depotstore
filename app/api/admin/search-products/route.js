import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDev } from "../_gate.js";
import { withVisibility } from "../../../lib/productQueries.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ products: [] });
  }

  // PostgREST treats , . : ( ) as filter syntax inside .or(). Wrap the value
  // in double quotes so they're parsed as literal data; escape \ and " inside.
  const escaped = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pattern = `"%${escaped}%"`;

  const { data, error } = await withVisibility(
    supabase
      .from("products")
      .select(
        "id, handle, store_domain, name, title, brand, price, image_url, store_name, available"
      ),
  )
    .or(`name.ilike.${pattern},title.ilike.${pattern},brand.ilike.${pattern}`)
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data || [] });
}
