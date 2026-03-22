export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) {
      return new Response("Missing email", { status: 400 });
    }

    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}`,
        },
        body: JSON.stringify({
          email,
          reactivate_existing: false,
          send_welcome_email: true,
          utm_source: "depot-website",
        }),
      }
    );

    if (!res.ok) {
      return new Response("Failed", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  } catch {
    return new Response("Failed", { status: 500 });
  }
}
