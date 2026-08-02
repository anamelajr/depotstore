-- Phase B1 of docs/plan-title-brand-formatting-repair.md — split brand families
-- collapsed onto one stored label each. Run in the Supabase SQL Editor (MCP is
-- read-only) AFTER the Phase A deploy. Snapshot `products` first.
--
-- A plain UPDATE is safe here, despite CLAUDE.md's absolute "editorial fields
-- write only if NULL" wording: that invariant exists to stop the enrich writers
-- from clobbering curated values, and every target below is already non-NULL,
-- so the COALESCE writers are no-ops on these rows either way. This is a
-- one-time relabel of values the code (BRAND_ALIASES/canonicalBrand) now
-- produces on its own for every future write.
--
-- Feed impact is nil: the brand filter is an ILIKE substring match.

-- Before:
SELECT brand, count(*) FROM products
 WHERE brand IN ('YVES SAINT LAURENT','YSL','SAINT LAURENT','SAINT LAURENT PARIS',
                 'MARGIELA','MARTIN MARGIELA','MAISON MARTIN MARGIELA','MAISON MARGIELA',
                 'COMME DES GARCONS','COMME DES GARÇONS',
                 'COMME DES GARCONS HOMME PLUS','COMME DES GARÇONS HOMME PLUS',
                 'GIANFRANCO FERRE','GIANFRANCO FERRÉ','FERRE','FERRÉ',
                 'COURREGES','COURRÈGES','McQUEEN','MCQUEEN','ALEXANDER McQUEEN',
                 'ALEXANDER MCQUEEN','FAYCAL','FAYCAL AMOR','FAYÇAL AMOR')
 GROUP BY brand ORDER BY brand;

UPDATE products SET brand = 'SAINT LAURENT'
 WHERE brand IN ('YVES SAINT LAURENT','YSL','SAINT LAURENT PARIS');

UPDATE products SET brand = 'MAISON MARGIELA'
 WHERE brand IN ('MARGIELA','MARTIN MARGIELA','MAISON MARTIN MARGIELA');

UPDATE products SET brand = 'COMME DES GARÇONS'
 WHERE brand = 'COMME DES GARCONS';

UPDATE products SET brand = 'COMME DES GARÇONS HOMME PLUS'
 WHERE brand = 'COMME DES GARCONS HOMME PLUS';

UPDATE products SET brand = 'GIANFRANCO FERRÉ'
 WHERE brand IN ('GIANFRANCO FERRE','FERRE','FERRÉ');

UPDATE products SET brand = 'COURRÈGES'
 WHERE brand = 'COURREGES';

UPDATE products SET brand = 'ALEXANDER MCQUEEN'
 WHERE brand IN ('McQUEEN','MCQUEEN','ALEXANDER McQUEEN');

UPDATE products SET brand = 'FAYÇAL AMOR'
 WHERE brand IN ('FAYCAL','FAYCAL AMOR');

-- After: expect exactly one surviving label per family.
SELECT brand, count(*) FROM products
 WHERE brand IN ('SAINT LAURENT','MAISON MARGIELA','COMME DES GARÇONS',
                 'COMME DES GARÇONS HOMME PLUS','GIANFRANCO FERRÉ','COURRÈGES',
                 'ALEXANDER MCQUEEN','FAYÇAL AMOR')
 GROUP BY brand ORDER BY brand;

-- Catch-all for any split this list missed (the Phase C audit enforces the same
-- invariant): two stored labels that differ only by case or diacritics.
SELECT lower(translate(brand,'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
                             'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuy')) AS folded,
       array_agg(DISTINCT brand), count(*)
  FROM products WHERE brand IS NOT NULL
 GROUP BY 1 HAVING count(DISTINCT brand) > 1;
