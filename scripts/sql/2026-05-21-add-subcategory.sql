-- Add subcategory column + CHECK constraint enforcing leaf-parent agreement.
-- Apply via Supabase SQL Editor (MCP is read-only).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory text NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_subcategory_matches_category;

ALTER TABLE public.products
  ADD CONSTRAINT products_subcategory_matches_category
  CHECK (
    subcategory IS NULL
    OR (category = 'Tops' AND subcategory IN ('tees','hoodies_sweaters','shirts_blouses','knitwear'))
    OR (category = 'Jackets & Coats' AND subcategory IN ('jackets','coats'))
    OR (category = 'Bags & Accessories' AND subcategory IN ('bags','accessories'))
  );
