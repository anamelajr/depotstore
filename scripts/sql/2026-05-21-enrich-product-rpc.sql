-- Update enrich_product to COALESCE-write subcategory alongside category.
-- The DROP-then-CREATE is required to avoid creating an OVERLOAD that
-- would make production main's named-arg calls ambiguous — see Phase 3
-- preamble. Wrapped in a transaction so the function never visibly
-- disappears (Postgres DDL is transactional).
-- Apply via Supabase SQL Editor.
--
-- Subcategory write guard: only COALESCE-write p_subcategory when the
-- effective parent (the row's existing category if set, else p_category)
-- equals p_category. Without this guard, a row whose existing category
-- disagrees with the classifier's new leaf parent (e.g. legacy
-- category='Tops' but classifier now says Bags & Accessories/accessories)
-- would receive a subcategory inconsistent with its kept category, and
-- the CHECK constraint would reject the update — burning enrich retries
-- silently on what is in practice a re-classification candidate.

BEGIN;

DROP FUNCTION IF EXISTS public.enrich_product(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.enrich_product(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.enrich_product(
  p_handle        text,
  p_store_domain  text,
  p_brand         text,
  p_title         text,
  p_category      text,
  p_subcategory   text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE products SET
    brand       = COALESCE(brand,       p_brand),
    title       = COALESCE(title,       p_title),
    category    = COALESCE(category,    p_category),
    subcategory = CASE
      WHEN COALESCE(category, p_category) = p_category
        THEN COALESCE(subcategory, p_subcategory)
      ELSE subcategory
    END
  WHERE handle = p_handle AND store_domain = p_store_domain;
END;
$$;

COMMIT;
