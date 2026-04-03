-- Dépôt products table
-- Run this in the Supabase SQL Editor to create the table.

CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  shopify_id    BIGINT,
  handle        TEXT NOT NULL,
  store_domain  TEXT NOT NULL,
  name          TEXT,
  title         TEXT,
  brand         TEXT,
  price         TEXT,
  image_url     TEXT,
  store_name    TEXT,
  product_url   TEXT,
  available     BOOLEAN DEFAULT true,
  synced_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (handle, store_domain)
);

CREATE INDEX IF NOT EXISTS idx_products_store ON products (store_domain);
CREATE INDEX IF NOT EXISTS idx_products_available ON products (available);
