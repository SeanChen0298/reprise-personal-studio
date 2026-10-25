import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { hostname } from "@tauri-apps/plugin-os";
import { usePhoneSyncStore } from "../stores/phone-sync-store";
import { pairingUrl } from "../lib/phone-sync";
import { timeAgo } from "./library-hero";

/** Settings → Phone: switch sync on, pair the phone by QR code. */
export function PhoneSettings() {
  const enabled = usePhoneSyncStore((s) => s.enabled);
  const setEnabled = usePhoneSyncStore((s) => s.setEnabled);
  const token = usePhoneSyncStore((s) => s.token);
  const resetToken = usePhoneSyncStore((s) => s.resetToken);
  const status = usePhoneSyncStore((s) => s.status);
  const error = usePhoneSyncStore((s) => s.error);
  const lastPull = usePhoneSyncStore((s) => s.lastPull);
  const lastImport = usePhoneSyncStore((s) => s.lastImport);
  const [host, setHost] = useState("Desktop");
  const [qr, setQr] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    hostname().then((h) => h && setHost(h)).catch(() => {});
  }, []);

  const url = status.running && status.ip && status.port ? pairingUrl(status.ip, status.port, token, host) : null;
  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [url]);

  const localOnly = status.ip === "127.0.0.1";

  return (
    <div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-[1.6] mb-5">
        Practise on your phone with the same songs: lyrics, your marks and notes, sections, the coach's song cards
        and the audio. It syncs over your home Wi-Fi, straight from this computer — nothing goes to the internet.
        Takes you record on the phone come back here for review.
      </p>

      <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-subtle)]">
        <div className="flex-1">
          <div className="text-[13px] font-medium mb-0.5">Sync with my phone</div>
          <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
            While this is on, the phone app can reach this computer on the same Wi-Fi. Windows may ask to allow Reprise
            on private networks — allow it.
          </div>
        </div>
        <label className="relative w-[38px] h-[22px] flex-shrink-0 cursor-pointer ml-4">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="opacity-0 w-0 h-0 absolute" />
          <span className="absolute inset-0 rounded-[12px] transition-colors duration-200" style={{ background: enabled ? "var(--theme)" : "var(--border)" }}>
            <span
              className="absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-200"
              style={{ transform: enabled ? "translateX(16px)" : "translateX(0)" }}
            />
          </span>
        </label>
      </div>

      {error && <p className="text-[12px] text-red-600 mt-3">Couldn't start sync: {error}</p>}

      {enabled && status.running && (
        <div className="mt-6 flex gap-6 items-start">
          <div className="w-[220px] h-[220px] rounded-[12px] bg-white border border-[var(--border)] flex items-center justify-center flex-shrink-0 overflow-hidden">
            {qr ? <img src={qr} alt="Pairing code" className="w-full h-full" /> : <span className="text-[12px] text-[var(--text-muted)]">…</span>}
          </div>
          <div className="flex-1 min-w-0 text-[13px] text-[var(--text-secondary)] leading-[1.6]">
            <div className="font-medium text-[var(--text-primary)] mb-1">Pair your phone</div>
            <ol className="list-decimal pl-5 mb-3">
              <li>Open Reprise on the phone (same Wi-Fi as this computer).</li>
              <li>Tap <span className="font-medium">Pair with computer</span> and scan this code.</li>
            </ol>
            <div className="text-[12px] text-[var(--text-muted)]">
              This computer: <span className="font-mono text-[var(--text-secondary)]">{status.ip}:{status.port}</span>
              {localOnly && <span className="text-amber-600"> — no Wi-Fi address found; is this computer on the network?</span>}
            </div>
            <button
              onClick={() => setShowCode((v) => !v)}
              className="mt-1 text-[12px] text-[var(--theme)] bg-transparent border-none cursor-pointer p-0 hover:underline"
            >
              {showCode ? "Hide code" : "Can't scan? Show the code to type in"}
            </button>
            {showCode && <div className="font-mono text-[13px] text-[var(--text-primary)] mt-1 select-all">{token}</div>}

            <div className="mt-4 text-[12px] text-[var(--text-muted)]">
              {lastPull ? `Phone last synced ${timeAgo(new Date(lastPull).toISOString())} (${new Date(lastPull).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "No phone has synced yet."}
              {lastImport && (
                <div>
                  From the phone: {lastImport.takes ? `${lastImport.takes} take${lastImport.takes === 1 ? "" : "s"}` : ""}
                  {lastImport.takes && lastImport.edits ? ", " : ""}
                  {lastImport.edits ? `${lastImport.edits} edit${lastImport.edits === 1 ? "" : "s"}` : ""} at{" "}
                  {new Date(lastImport.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (window.confirm("Make a new pairing code? Phones paired with the old one will need to scan again.")) resetToken();
              }}
              className="mt-3 text-[12px] px-3 py-[5px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Unpair all phones (new code)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
