/**
 * google-drive-refresh
 * Refreshes an expired Google Drive access token.
 * Called directly by the mobile app (POST request).
 *
 * Request body: { refresh_token: string }
 * Response:     { access_token: string, expires_in: number }
 */
const CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET")!;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { refresh_token } = await req.json() as { refresh_token: string };

  if (!refresh_token) {
    return new Response(JSON.stringify({ error: "missing refresh_token" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token,
    }).toString(),
  });

  if (!tokenRes.ok) {
    return new Response(JSON.stringify({ error: "refresh_failed" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const json = await tokenRes.json() as { access_token: string; expires_in: number };
  return new Response(JSON.stringify({ access_token: json.access_token, expires_in: json.expires_in }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
