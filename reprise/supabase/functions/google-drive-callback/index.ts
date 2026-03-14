/**
 * google-drive-callback
 * Receives the authorization code from Google, exchanges it for tokens,
 * then redirects back to the Reprise app via deep link.
 *
 * Deep link format: reprise://auth/drive-callback?access_token=...&refresh_token=...&expires_in=...&state=...
 */
const CLIENT_ID = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/google-drive-callback`;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");

  if (error || !code) {
    const appUrl = new URL("reprise://auth/drive-callback");
    appUrl.searchParams.set("error", error ?? "missing_code");
    appUrl.searchParams.set("state", state);
    return Response.redirect(appUrl.toString(), 302);
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: CALLBACK_URL,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const appUrl = new URL("reprise://auth/drive-callback");
    appUrl.searchParams.set("error", "token_exchange_failed");
    appUrl.searchParams.set("state", state);
    return Response.redirect(appUrl.toString(), 302);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const appUrl = new URL("reprise://auth/drive-callback");
  appUrl.searchParams.set("access_token", tokens.access_token);
  if (tokens.refresh_token) {
    appUrl.searchParams.set("refresh_token", tokens.refresh_token);
  }
  appUrl.searchParams.set("expires_in", String(tokens.expires_in));
  appUrl.searchParams.set("state", state);

  return Response.redirect(appUrl.toString(), 302);
});
