import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/auth-store";

const STORAGE_KEY = "reprise-mobile-output-device";

interface AudioDevice {
  deviceId: string;
  label: string;
}

function useAudioOutputDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "default"
  );

  useEffect(() => {
    async function enumerate() {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      // Trigger permission prompt if needed by requesting a dummy stream
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop());
        });
      } catch {
        // Permission denied — still try to enumerate
      }

      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Audio output ${d.deviceId.slice(0, 6)}`,
        }));

      if (outputs.length > 0) setDevices(outputs);
    }

    enumerate();

    navigator.mediaDevices?.addEventListener("devicechange", enumerate);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", enumerate);
  }, []);

  function select(deviceId: string) {
    setSelectedId(deviceId);
    localStorage.setItem(STORAGE_KEY, deviceId);
  }

  return { devices, selectedId, select };
}

export default function SettingsPage() {
  const { user, signOut } = useAuthStore();
  const { devices, selectedId, select } = useAudioOutputDevices();

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="px-5 pb-4"
        style={{ paddingTop: "max(28px, env(safe-area-inset-top))" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-6">
        {/* Audio output */}
        <section>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Audio Output
          </h2>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {devices.length === 0 ? (
              <div className="px-4 py-4">
                <p className="text-[13.5px] text-[var(--color-text-muted)]">
                  No audio output devices found.
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-text-muted)] opacity-60">
                  Audio output selection requires browser permission on some platforms.
                </p>
              </div>
            ) : (
              devices.map((device, i) => (
                <button
                  key={device.deviceId}
                  onClick={() => select(device.deviceId)}
                  className={[
                    "flex w-full min-h-[52px] items-center justify-between px-4 py-3 text-left active:bg-[var(--color-border)]",
                    i > 0 ? "border-t border-[var(--color-border)]" : "",
                  ].join(" ")}
                >
                  <span className="text-[14px] text-[var(--color-text)]">{device.label}</span>
                  {selectedId === device.deviceId && (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-theme-light)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
          <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
            Selected output applies to audio playback in the Practice view.
          </p>
        </section>

        {/* Account */}
        <section>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Account
          </h2>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-theme)] text-[13px] font-semibold text-white">
                {user?.email?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-[var(--color-text)]">
                  {user?.user_metadata?.full_name ?? user?.email ?? "Signed in"}
                </p>
                {user?.email && (
                  <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                    {user.email}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={signOut}
              className="flex w-full min-h-[52px] items-center px-4 py-3 text-left active:bg-[var(--color-border)]"
            >
              <span className="text-[14px] text-red-400">Sign out</span>
            </button>
          </div>
        </section>

        {/* App info */}
        <section>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            About
          </h2>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[14px] text-[var(--color-text)]">Reprise Mobile</span>
              <span className="text-[13px] text-[var(--color-text-muted)]">v0.1.0</span>
            </div>
          </div>
          <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
            Practice companion. Songs sync from the desktop app via Supabase.
          </p>
        </section>
      </div>
    </div>
  );
}
