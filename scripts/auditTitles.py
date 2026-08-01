#!/usr/bin/env python3
"""Read-only audit of products.title against the agreed convention."""
import json, os, re, sys, urllib.request, unicodedata
from collections import Counter, defaultdict

URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

def fetch_all():
    rows, off, page = [], 0, 1000
    while True:
        req = urllib.request.Request(
            f"{URL}/rest/v1/products?select=id,brand,title,name,store_domain"
            f"&hidden=eq.false&available=eq.true&order=id.asc&limit={page}&offset={off}",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        batch = json.load(urllib.request.urlopen(req))
        rows += batch
        if len(batch) < page: return rows
        off += page

def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()

# brand tokens that should never appear in a title (allowlist-ish, incl. short aliases)
BRAND_WORDS = ["ysl", "gucci", "prada", "chanel", "dior", "margiela", "valentino", "miu miu",
    "versace", "cavalli", "armani", "fendi", "celine", "givenchy", "balenciaga", "burberry",
    "hermes", "lanvin", "moschino", "kenzo", "gaultier", "westwood", "mugler", "rykiel",
    "ferragamo", "missoni", "dolce", "gabbana", "galliano", "tom ford", "saint laurent",
    "yamamoto", "comme des garcons", "cdg", "issey miyake", "junya", "raf simons",
    "helmut lang", "ann demeulemeester", "rick owens", "drkshdw", "mcqueen", "chloe",
    "loewe", "bottega", "courreges", "alaia", "dries", "marni", "jacquemus", "acne",
    "maison martin margiela", "mm6", "d&g", "emporio"]

SEASON_MID = re.compile(r"\S\s+\b(FW|SS|AW)\d{2}(/\d{2})?\b", re.I)      # season not at start
SEASON_START = re.compile(r"^(FW|SS|AW)\d{2}(/\d{2})?\b")
BAD_SEASON = re.compile(r"\b(fw|ss|aw)\s?(19|20)\d{2}\b|\b(Fw|Ss|Aw)\d{2}\b|\bS/S|\bF/W|\bA/W|\bspring[ /-]summer|\bfall[ /-]winter|\bautumn[ /-]winter", re.I)
GOODISH_BAD_SEASON = re.compile(r"\b(FW|SS|AW)(19|20)\d{2}\b|\b[FSA]/[WS]\b|\b(Fall|Autumn)[\s/-]+Winter\b|\bSpring[\s/-]+Summer\b", re.I)
DASH = re.compile(r"\s-\s")
LOWER_AFTER_SLASH = re.compile(r"[A-Za-z]/[a-z]")
LOWER_AFTER_HYPHEN = re.compile(r"[A-Za-z]-[a-z][a-z]")  # e.g. Button-up, Half-rim (Title Case would cap)
TRAILING_BY = re.compile(r"\bBy\b\s*$", re.I)
DECADE_BAD = re.compile(r"\b(19|20)\d0S\b")
UPPER_RUN = re.compile(r"\b[A-Z]{2,}\b")

def classify(r):
    t = (r["title"] or "").strip()
    issues = []
    if not t:
        return ["null_or_empty_title"]
    ft = fold(t)
    fb = fold(r["brand"] or "")
    # brand leak: own brand or any brand word in title
    for w in BRAND_WORDS:
        if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", ft):
            issues.append("brand_word_in_title:" + w); break
    if fb and re.search(r"(?<![a-z])" + re.escape(fb) + r"(?![a-z])", ft):
        if not any(i.startswith("brand_word_in_title") for i in issues):
            issues.append("own_brand_in_title")
    if DASH.search(t): issues.append("dash_in_title")
    if SEASON_MID.search(t) and not SEASON_START.match(t): issues.append("season_not_first")
    if GOODISH_BAD_SEASON.search(t): issues.append("uncompacted_season_code")
    if DECADE_BAD.search(t): issues.append("decade_upper_S")
    if TRAILING_BY.search(t): issues.append("trailing_by")
    if LOWER_AFTER_SLASH.search(t): issues.append("lowercase_after_slash")
    if len(t.split()) > 7: issues.append("over_7_words")
    if re.search(r"\((?!runway)", t): issues.append("parenthetical")
    return issues

# Brand-family convergence check (Phase C of docs/plan-title-brand-formatting-repair.md):
# any of these legacy labels surviving in `brand`, or any two stored labels that fold to
# the same string (case/diacritic split), is a violation → exit 1.
LEGACY_BRAND_LABELS = {
    "YVES SAINT LAURENT", "YSL", "SAINT LAURENT PARIS",
    "MARGIELA", "MARTIN MARGIELA", "MAISON MARTIN MARGIELA",
    "COMME DES GARCONS", "COMME DES GARCONS HOMME PLUS",
    "GIANFRANCO FERRE", "FERRE", "FERRÉ",
    "COURREGES", "McQUEEN", "MCQUEEN", "ALEXANDER McQUEEN",
    "FAYCAL", "FAYCAL AMOR",
}

def audit_brands(rows):
    counts = Counter((r["brand"] or "NULL") for r in rows)
    violations = []
    for label, n in sorted(counts.items()):
        if label in LEGACY_BRAND_LABELS:
            violations.append(f"legacy label survives: {label!r} x{n}")
    fold_groups = defaultdict(list)
    for label, n in counts.items():
        if label != "NULL":
            fold_groups[fold(label)].append((label, n))
    for variants in fold_groups.values():
        if len(variants) > 1:
            violations.append(f"split label group: {variants}")
    return violations

rows = fetch_all()
print(f"total visible rows: {len(rows)}", file=sys.stderr)
brand_violations = audit_brands(rows)
by_issue = defaultdict(list)
for r in rows:
    for i in classify(r):
        by_issue[i.split(":")[0]].append((i, r))

out = {}
for k, v in sorted(by_issue.items(), key=lambda kv: -len(kv[1])):
    out[k] = {"count": len(v),
              "examples": [{"id": r["id"], "brand": r["brand"], "title": r["title"],
                            "store": r["store_domain"], "tag": i} for i, r in v[:200]]}
out_path = sys.argv[1] if len(sys.argv) > 1 else "title-audit.json"
json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1)
print(f"wrote {out_path}", file=sys.stderr)
for k, v in out.items():
    print(f"{k}: {v['count']}")
    for e in v["examples"][:8]:
        print(f"   [{e['store']}] {e['brand']} | {e['title']}  ({e['tag']})")
print("--- brand-family convergence:")
if brand_violations:
    for v in brand_violations:
        print(f"  VIOLATION: {v}")
else:
    print("  OK: no legacy labels, no split label groups")
# null_or_empty_title is transient (rows mid-enrich-queue), so it reports but doesn't fail.
hard_issues = {k: v for k, v in by_issue.items() if k != "null_or_empty_title"}
sys.exit(1 if (brand_violations or hard_issues) else 0)
