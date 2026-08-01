-- Phase B3 of docs/plan-title-brand-formatting-repair.md — junk-title reset.
-- Generated from docs/snapshots/2026-08-01-title-audit.json. Run in the Supabase
-- SQL Editor AFTER the Phase A deploy and AFTER B1 + B2, so the re-enrich passes
-- through the hardened guards. Snapshot `products` first.
--
-- Every statement is a compare-and-swap on the AUDITED value: the snapshot
-- predates B1/B2 and any manual edit, so a row whose state has drifted must be
-- REPORTED, not overwritten. Zero-row updates are the expected safety outcome,
-- not an error. (Hourly enrichment cannot itself alter these rows — the RPC
-- COALESCE only fills NULLs and every target is non-NULL — so no enrich pause
-- is needed.)
--
-- NOTE: B1 relabels brands BEFORE this runs, so the bucket-2 brand CAS below
-- uses the POST-B1 label. Bucket 1 does not CAS on brand at all.

-- ============ Bucket 1: brand correct, title junk ============
-- title -> NULL + attempts reset; the hourly enrich queue picks them up.
-- [yourgarmentz.com] DIOR | John Galliano Leather Clutch
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 196847 AND title = 'John Galliano Leather Clutch';
-- [graindesell.shop] DIOR | Christian SS02 Monogram Nylon Pants
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 5858170 AND title = 'Christian SS02 Monogram Nylon Pants';
-- [lesarchivesparis.com] TOM FORD | Gucci By FW96 Pinstripe Wool Suit
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 13346293 AND title = 'Gucci By FW96 Pinstripe Wool Suit';
-- [lesarchivesparis.com] JOHN GALLIANO | Dior By FW02 Printed Wrap Top
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 13993204 AND title = 'Dior By FW02 Printed Wrap Top';
-- [dolcevitahub.com] TOM FORD | 2000s Gucci Blue Sky Corduroy Pants By
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14020121 AND title = '2000s Gucci Blue Sky Corduroy Pants By';
-- [dolcevitahub.com] SAINT LAURENT | Khaki Canvas Ysl Logo Messenger Bag
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14174538 AND title = 'Khaki Canvas Ysl Logo Messenger Bag';
-- [dolcevitahub.com] YVES SAINT LAURENT | Leopard Pony Hair Ysl Impact Logo Bracelet
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14372804 AND title = 'Leopard Pony Hair Ysl Impact Logo Bracelet';
-- [lobscur.com] RICK OWENS | Drkshdw - Cotton Tank Top
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14534806 AND title = 'Drkshdw - Cotton Tank Top';
-- [treviseparis.com] JOHN GALLIANO | London SS87 Charcoal Fine-knit Turtleneck Bodysuit
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14880839 AND title = 'London SS87 Charcoal Fine-knit Turtleneck Bodysuit';
-- [treviseparis.com] MARGIELA | Martin SS98 Flat Deconstructed Blazer
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14880893 AND title = 'Martin SS98 Flat Deconstructed Blazer';
-- [treviseparis.com] COMME DES GARÇONS | Tao FW07 Cable Knit Asymmetric Dress
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14881061 AND title = 'Tao FW07 Cable Knit Asymmetric Dress';
-- [treviseparis.com] VALENTINO | Boutique FW96 Beaded Black Evening Ensemble
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14937632 AND title = 'Boutique FW96 Beaded Black Evening Ensemble';
-- [chezsnowbunny.fr] DIOR | By Galliano Nude Lace Details Dress
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14940924 AND title = 'By Galliano Nude Lace Details Dress';
-- [chezsnowbunny.fr] DIOR | Dior Dice Mules By Galliano T.37
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14940972 AND title = 'Dior Dice Mules By Galliano T.37';
-- [chezsnowbunny.fr] GUCCI | Tom Ford Khaki Mid Skirt
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941022 AND title = 'Tom Ford Khaki Mid Skirt';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Transparent Silver Temple Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941257 AND title = 'Ysl Transparent Silver Temple Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Silver Stainless Steel Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941258 AND title = 'Ysl Silver Stainless Steel Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Tortoiseshell Silver Temple Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941259 AND title = 'Ysl Tortoiseshell Silver Temple Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Green Blue Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941262 AND title = 'Ysl Green Blue Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Dark Blue Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941264 AND title = 'Ysl Dark Blue Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Silver Navy Blue Temple Bayonettas Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941265 AND title = 'Ysl Silver Navy Blue Temple Bayonettas Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Rectangular Metal Ysl Logo Temples Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941266 AND title = 'Ysl Rectangular Metal Ysl Logo Temples Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Black Metal Half-rim Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941267 AND title = 'Ysl Black Metal Half-rim Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Matte Black Rectangular Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941270 AND title = 'Ysl Matte Black Rectangular Glasses';
-- [chezsnowbunny.fr] YVES SAINT LAURENT | Ysl Transparent Blue/grey Rectangular Glasses
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14941271 AND title = 'Ysl Transparent Blue/grey Rectangular Glasses';
-- [chezsnowbunny.fr] JOHN GALLIANO | Dior By 2003 Heels
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14942261 AND title = 'Dior By 2003 Heels';
-- [chezsnowbunny.fr] DIOR | Silk Dress By Galliano
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14943013 AND title = 'Silk Dress By Galliano';
-- [chezsnowbunny.fr] GUCCI | Tom Ford Black Top
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14943586 AND title = 'Tom Ford Black Top';
-- [dolcevitahub.com] ROBERTO CAVALLI | 2000s Cavalli Black Nylon Quilted Puffer Jacket
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14948244 AND title = '2000s Cavalli Black Nylon Quilted Puffer Jacket';
-- [dolcevitahub.com] TOM FORD | SS01 Gucci Dragon Black High Sneakers By
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15462611 AND title = 'SS01 Gucci Dragon Black High Sneakers By';
-- [numero13vintage.com] COMME DES GARÇONS | Tao SS09 Black Sheer Midi Skirt
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15481896 AND title = 'Tao SS09 Black Sheer Midi Skirt';
-- [dolcevitahub.com] DOLCE & GABBANA | 2000s Grey Steve Mcqueen Hoodie
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15897474 AND title = '2000s Grey Steve Mcqueen Hoodie';
-- [dolcevitahub.com] TOM FORD | 1990s Gucci Navy Cashmere Long Coat By
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15960225 AND title = '1990s Gucci Navy Cashmere Long Coat By';
-- [lobscur.com] COMME DES GARÇONS | Girl - Wool Dress With Front Bows
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15982546 AND title = 'Girl - Wool Dress With Front Bows';
-- [lobscur.com] COMME DES GARÇONS | Black - FW14 Heavy Wool Suspender Skirt
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15982547 AND title = 'Black - FW14 Heavy Wool Suspender Skirt';
-- [lobscur.com] COMME DES GARÇONS | Black - FW12 Poly Cotton Rider Cape
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15982548 AND title = 'Black - FW12 Poly Cotton Rider Cape';
-- [dolcevitahub.com] DOLCE & GABBANA | 2000s Steve Mcqueen Grey Hoodie
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15987259 AND title = '2000s Steve Mcqueen Grey Hoodie';
-- [dolcevitahub.com] RICK OWENS | SS15 Drkshdw Dust Berling Drawstrings Sweatpants
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 15987261 AND title = 'SS15 Drkshdw Dust Berling Drawstrings Sweatpants';
-- [dolcevitahub.com] TOM FORD | 2000s Gucci Black Leather Pants By
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 16231010 AND title = '2000s Gucci Black Leather Pants By';
-- [lobscur.com] ANN DEMEULEMEESTER | Blanche - Painted High Top Sneakers
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 16459500 AND title = 'Blanche - Painted High Top Sneakers';
-- [dolcevitahub.com] RAF SIMONS | Calvin Klein 205w39nyc Cow-boy Leather Boots By
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 14953917 AND title = 'Calvin Klein 205w39nyc Cow-boy Leather Boots By';
-- [nuovo-paris.com] VALENTINO | Shorts - Red
UPDATE products SET title = NULL, enrich_attempts = 0
 WHERE id = 12744024 AND title = 'Shorts - Red';

-- ============ Bucket 2: brand wrong too — full editorial reset ============
-- subcategory must reset alongside category or products_subcategory_matches_category trips.
-- [seyswardrobe.fr] 1017 ALYX 9SM | Dior - B23
UPDATE products SET brand = NULL, title = NULL, category = NULL, subcategory = NULL, enrich_attempts = 0
 WHERE id = 15898105 AND title = 'Dior - B23' AND brand = '1017 ALYX 9SM';

-- ============ Verification: survivors drifted since the audit ============
SELECT id, brand, title FROM products
 WHERE id IN (196847, 5858170, 13346293, 13993204, 14020121, 14174538, 14372804, 14534806, 14880839, 14880893, 14881061, 14937632, 14940924, 14940972, 14941022, 14941257, 14941258, 14941259, 14941262, 14941264, 14941265, 14941266, 14941267, 14941270, 14941271, 14942261, 14943013, 14943586, 14948244, 15462611, 15481896, 15897474, 15960225, 15982546, 15982547, 15982548, 15987259, 15987261, 16231010, 16459500, 14953917, 12744024, 15898105)
   AND title IS NOT NULL;
-- Expected: 0 rows. Any row returned drifted after 2026-08-01 → review by hand, do not force.

-- ============ Manual review — flagged, never auto-reset ============
-- id 831252 [dolcevitahub.com] MAISON MARGIELA | MM6 Velvet Distressed Pants  -- brand may itself be MM6
-- id 833406 [dolcevitahub.com] MAISON MARGIELA | MM6 Timer Brut Necklace  -- brand may itself be MM6
-- id 14941964 [chezsnowbunny.fr] MARGIELA | Mm6 Brown Washed Joggers  -- brand may itself be MM6
-- id 14941965 [chezsnowbunny.fr] MARGIELA | Mm6 Suit Grey Fitted Pant  -- brand may itself be MM6
-- id 13971162 [lesarchivesparis.com] MARGIELA | Hermes By Martin 1990s Silk Cardigan Top  -- Margiela's Hermes era — 'By Martin' is editorially meaningful
-- id 15239796 [numero13vintage.com] YOHJI YAMAMOTO | Y’s FW11 Black Hooded Shirt  -- brand may itself be Y'S (a Yohji sub-label already in the catalog)

-- ============ B4: the 27 treviseparis null-title rows — verify only ============
SELECT enrich_attempts, count(*) FROM products
 WHERE title IS NULL AND store_domain = 'treviseparis.com'
 GROUP BY enrich_attempts ORDER BY enrich_attempts;
-- attempts < 3 → mid-queue, no action. Stuck at 3 → UPDATE ... SET enrich_attempts = 0 for those ids.
