import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeCodeForToken, storeToken } from "../lib/google-drive";

/**
 * Landing page for the Google Drive OAuth2 PKCE callback.
 * Google redirects here after the user grants Drive access.
 *
 * URL params:  ?code=AUTH_CODE&state=ENCODED_STATE[&error=...]
 * SessionStorage key: "reprise_drive_pkce_verifier"
 */
export function DriveAuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stateRaw = params.get("state");
    const error = params.get("error");

    if (error) {
      setErrorMsg(`Google Drive access was denied: ${error}`);
      setStatus("error");
      return;
    }
    if (!code) {
      setErrorMsg("No authorization code returned from Google.");
      setStatus("error");
      return;
    }

    const verifier = sessionStorage.getItem("reprise_drive_pkce_verifier");
    if (!verifier) {
      setErrorMsg("PKCE verifier missing — please try connecting Drive again.");
      setStatus("error");
      return;
    }

    // Parse state to find where to redirect after success
    let returnTo = "/library";
    if (stateRaw) {
      try {
        const state = JSON.parse(decodeURIComponent(stateRaw)) as { returnTo?: string };
        if (state.returnTo) returnTo = state.returnTo;
      } catch {
        // ignore malformed state
      }
    }

    exchangeCodeForToken(code, verifier)
      .then((token) => {
        storeToken(token);
        sessionStorage.removeItem("reprise_drive_pkce_verifier");
        navigate(returnTo, { replace: true });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setStatus("error");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
      <div className="flex flex-col items-center gap-4 text-center max-w-[360px]">
        {status === "loading" ? (
          <>
            <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            <p className="text-[14px] text-[var(--text-muted)]">
              Connecting to Google Drive…
            </p>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              Drive connection failed
            </p>
            <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-85 transition-opacity"
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
