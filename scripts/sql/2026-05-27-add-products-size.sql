-- Add products.size for parsed-from-Shopify size value.
--
-- Storage shape: TEXT[] (native Postgres string array), nullable.
--   Single size:           {S}  /  {"42 IT"}  /  {"38 FR / M / 42 IT"}
--   Single size with dot:  {"MEN S · WOMEN M"}   (one element — the
--                                                 middle dot is part of
--                                                 the seller's value)
--   Multi-variant:         {S,M,L}
--   No usable size:        NULL
--
-- TEXT[] (not joined TEXT) is required because a single Shopify Size
-- option value can itself contain ` · ` (covered by the parseSizes L1
-- test for Taille `MEN S · WOMEN M`). A TEXT-with-delimiter shape would
-- corrupt that on round-trip; the array preserves element boundaries.
--
-- Unlike brand/title/category/subcategory, `size` is NOT an editorial
-- field — it's a mechanical projection from Shopify. The cron Step-1
-- sync overwrites it every run (same model as `name`, `price`,
-- `available`). No COALESCE-protection, no `enrich_product` RPC change.
--
-- Apply via Supabase SQL Editor.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size TEXT[];

COMMIT;
