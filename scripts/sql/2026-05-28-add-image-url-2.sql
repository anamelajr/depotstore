-- Add products.image_url_2 for the hover-swap second product image.
--
-- Storage shape: TEXT, nullable. Populated by the hourly Shopify cron
-- (Step-1 plain upsert) from images[1].src, with a dedup guard in
-- normalizeProduct so an images[1] === images[0] re-upload artifact lands
-- as NULL.
--
-- Like image_url / name / price / available, image_url_2 is a MECHANICAL
-- projection from Shopify — NOT an editorial field. It is overwritten every
-- run and is deliberately NOT routed through the enrich_product COALESCE
-- block; COALESCE-protecting it would freeze Shopify gallery reorders.
--
-- get_interleaved_products must be DROP+CREATE'd (not CREATE OR REPLACE)
-- because its RETURNS TABLE shape changes — Postgres rejects a return-type
-- change on CREATE OR REPLACE FUNCTION. count_interleaved_products is NOT
-- touched: its bigint return is unchanged, so a parity DROP would only risk
-- resetting its grants for zero benefit.
--
-- The RPC body below is the live production definition (captured via
-- pg_get_functiondef on 2026-05-28), with the minimum delta applied:
-- image_url_2 added to the RETURNS TABLE and to both SELECT lists (the
-- `ranked` CTE and the final SELECT). DROP+CREATE resets the function ACL
-- to Postgres defaults (PUBLIC gets EXECUTE on CREATE); the explicit
-- anon/authenticated/service_role grants captured from production are
-- re-applied below to preserve the exact ACL.
--
-- Companion to scripts/sql/2026-05-21-interleaved-rpcs.sql (original RPC).
--
-- Apply via Supabase SQL Editor BEFORE merging dependent code (CLAUDE.md:
-- schema/RPC changes apply before dependent code merges).

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url_2 TEXT;

DROP FUNCTION IF EXISTS public.get_interleaved_products(
  text, text, text, text, integer, integer, text
);

CREATE FUNCTION public.get_interleaved_products(
  p_store text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_brand text DEFAULT NULL::text,
  p_limit integer DEFAULT 42,
  p_offset integer DEFAULT 0,
  p_subcategory text DEFAULT NULL::text
)
RETURNS TABLE(
  id bigint,
  handle text,
  name text,
  title text,
  brand text,
  price text,
  image_url text,
  image_url_2 text,
  product_url text,
  available boolean,
  store_domain text,
  store_name text,
  category text,
  synced_at timestamp with time zone
)
LANGUAGE sql
STABLE
AS $function$
  WITH weekly_seed AS (
    SELECT FLOOR(EXTRACT(EPOCH FROM CURRENT_DATE) / 604800)::int AS seed
  ),
  store_order AS (
    SELECT
      store_domain,
      ROW_NUMBER() OVER (
        ORDER BY MD5(store_domain || (SELECT seed::text FROM weekly_seed))
      ) AS store_position
    FROM products
    WHERE available = true AND hidden = false
    GROUP BY store_domain
  ),
  ranked AS (
    SELECT
      p.id, p.handle, p.name, p.title, p.brand, p.price, p.image_url, p.image_url_2,
      p.product_url, p.available, p.store_domain, p.store_name,
      p.category, p.synced_at,
      ROW_NUMBER() OVER (
        PARTITION BY p.store_domain ORDER BY p.synced_at DESC
      ) AS store_rank,
      so.store_position
    FROM products p
    JOIN store_order so ON so.store_domain = p.store_domain
    WHERE
      p.available = true
      AND p.hidden = false
      AND (p_store IS NULL OR p.store_domain = p_store)
      AND (p_category IS NULL OR p.category = ANY(string_to_array(p_category, ',')))
      AND (p_subcategory IS NULL OR p.subcategory = ANY(string_to_array(p_subcategory, ',')))
      AND (p_brand IS NULL OR extensions.unaccent(p.brand) ILIKE '%' || extensions.unaccent(p_brand) || '%')
      AND (
        p_search IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(regexp_split_to_array(trim(p_search), '\s+')) AS raw_word
          WHERE
            replace(replace(raw_word, '%', ''), '_', '') <> ''
            AND length(replace(replace(raw_word, '%', ''), '_', '')) >= 2
            AND (
              COALESCE(p.title, '') || ' ' ||
              COALESCE(p.brand, '') || ' ' ||
              COALESCE(p.name,  '')
            ) NOT ILIKE '%' || replace(replace(raw_word, '%', ''), '_', '') || '%'
        )
      )
  )
  SELECT
    id, handle, name, title, brand, price, image_url, image_url_2,
    product_url, available, store_domain, store_name,
    category, synced_at
  FROM ranked
  ORDER BY
    FLOOR((store_rank - 1) / 6) ASC,
    store_position ASC,
    store_rank ASC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.get_interleaved_products(
  text, text, text, text, integer, integer, text
) TO anon, authenticated, service_role;

COMMIT;
