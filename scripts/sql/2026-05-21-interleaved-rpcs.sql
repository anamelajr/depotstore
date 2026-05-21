-- Update interleaved RPCs to accept p_subcategory. DROP-then-CREATE is
-- required to avoid overload ambiguity on production main's named-arg
-- calls — see Phase 3 preamble. Single transaction so neither function
-- visibly disappears (Postgres DDL is transactional).
-- Apply via Supabase SQL Editor.

BEGIN;

-- ─── get_interleaved_products ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_interleaved_products(text, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_interleaved_products(
  p_store       text    DEFAULT NULL::text,
  p_category    text    DEFAULT NULL::text,
  p_search      text    DEFAULT NULL::text,
  p_brand       text    DEFAULT NULL::text,
  p_limit       integer DEFAULT 42,
  p_offset      integer DEFAULT 0,
  p_subcategory text    DEFAULT NULL::text
) RETURNS TABLE(
  id           bigint,
  handle       text,
  name         text,
  title        text,
  brand        text,
  price        text,
  image_url    text,
  product_url  text,
  available    boolean,
  store_domain text,
  store_name   text,
  category     text,
  synced_at    timestamp with time zone
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
      p.id, p.handle, p.name, p.title, p.brand, p.price, p.image_url,
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
    id, handle, name, title, brand, price, image_url,
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

-- ─── count_interleaved_products ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.count_interleaved_products(text, text, text, text);

CREATE OR REPLACE FUNCTION public.count_interleaved_products(
  p_store       text DEFAULT NULL::text,
  p_category    text DEFAULT NULL::text,
  p_search      text DEFAULT NULL::text,
  p_brand       text DEFAULT NULL::text,
  p_subcategory text DEFAULT NULL::text
) RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  SELECT COUNT(*)
  FROM products p
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
    );
$function$;

COMMIT;
