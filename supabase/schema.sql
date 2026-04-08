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

-- Partner stores table
CREATE TABLE IF NOT EXISTS stores (
  id           BIGSERIAL PRIMARY KEY,
  domain       TEXT NOT NULL UNIQUE,
  store_name   TEXT NOT NULL,
  display_name TEXT NOT NULL,
  location     TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

INSERT INTO stores (domain, store_name, display_name, location, lat, lng, active) VALUES
  ('lobscur.com',          'L''OBSCUR',          'L''Obscur',          'Le Marais',              48.8621, 2.3543, true),
  ('dolcevitahub.com',     'Dolce Vita Hub',     'Dolce Vita Hub',     'Le Marais',              48.8574, 2.3756, true),
  ('seyswardrobe.fr',      'Seys Wardrobe',      'Seys Wardrobe',      'Paris',                  NULL,    NULL,   false),
  ('numero13vintage.com',  'Numero 13 Vintage',  'Numero 13 Vintage',  'Le Marais',              48.8601, 2.3589, true),
  ('lesarchivesparis.com', 'Les Archives Paris', 'Les Archives Paris', 'Saint-Germain-des-Prés', 48.8502, 2.3278, true),
  ('atdawnparis.com',      'at dawn paris',      'AT Dawn Paris',      'Le Marais',              48.8626, 2.3574, true),
  ('nuovo-paris.com',      'Nuovo Paris',        'Nuovo Paris',        'Le Marais',              48.8609, 2.3601, true),
  ('yourgarmentz.com',     'yourgarmentz',       'yourgarmentz',       'Paris',                  NULL,    NULL,   true),
  ('www.dotcomme.net',     'dot COMME',          'dot COMME',          'Le Marais',              NULL,    NULL,   true),
  ('escoparis.com',        'ESCO',               'ESCO',               'Paris',                  NULL,    NULL,   true),
  ('graindesell.shop',     'Grain de sell',      'Grain de sell',      'Paris',                  NULL,    NULL,   true)
ON CONFLICT (domain) DO NOTHING;
