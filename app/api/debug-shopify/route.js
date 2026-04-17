export const dynamic = "force-dynamic";

const TARGET_HANDLE = "jitrois-leather-dress-1";
const STORE_DOMAIN = "escoparis.com";

async function findVariant(urlBase, headers = {}) {
  let page = 1;
  while (page <= 20) {
    const res = await fetch(`${urlBase}?limit=250&page=${page}`, { headers });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    if (products.length === 0) return { notFound: true, pagesChecked: page };
    const match = products.find((p) => p.handle === TARGET_HANDLE);
    if (match) {
      return {
        pagesChecked: page,
        variant: match.variants?.[0]
          ? {
              id: match.variants[0].id,
              price: match.variants[0].price,
              available: match.variants[0].available,
              updated_at: match.variants[0].updated_at,
            }
          : null,
      };
    }
    if (products.length < 250) return { notFound: true, pagesChecked: page };
    page++;
  }
  return { notFound: true, pagesChecked: page };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = `https://${STORE_DOMAIN}/products.json`;

  const attempts = {
    default: await findVariant(base),
    acceptLangFR: await findVariant(base, { "Accept-Language": "fr-FR,fr;q=0.9" }),
    userAgentFR: await findVariant(base, {
      "Accept-Language": "fr-FR,fr;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    }),
    cfIpCountryFR: await findVariant(base, { "CF-IPCountry": "FR" }),
    xForwardedForFR: await findVariant(base, { "X-Forwarded-For": "82.64.0.1" }),
  };

  const localePath = await findVariant(`https://${STORE_DOMAIN}/fr-fr/products.json`);
  attempts.fr_fr_path = localePath;

  const countryParam = await fetch(`${base}?limit=250&page=1&country=FR`).then((r) => r.ok ? r.json() : null);
  if (countryParam) {
    const match = countryParam.products?.find((p) => p.handle === TARGET_HANDLE);
    attempts.countryQueryParam = match
      ? { variant: { id: match.variants[0].id, price: match.variants[0].price, available: match.variants[0].available } }
      : { notFound: true };
  }

  return Response.json({ target: TARGET_HANDLE, store: STORE_DOMAIN, attempts });
}
