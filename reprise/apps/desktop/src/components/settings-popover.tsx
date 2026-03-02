import { useEffect, useRef, useState } from "react";
import type { AudioDevice } from "../hooks/use-audio-devices";

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  skipCountdown?: boolean;
  onSkipCountdownToggle?: () => void;
  recordThrough?: boolean;
  onRecordThroughToggle?: () => void;
  inputDevices?: AudioDevice[];
  outputDevices?: AudioDevice[];
  selectedInputId?: string;
  selectedOutputId?: string;
  onInputChange?: (id: string) => void;
  onOutputChange?: (id: string) => void;
}

export function SettingsPopover({
  open, onClose, anchorRef,
  skipCountdown, onSkipCountdownToggle,
  recordThrough, onRecordThroughToggle,
  inputDevices, outputDevices,
  selectedInputId, selectedOutputId,
  onInputChange, onOutputChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Calculate position from anchor element
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay to avoid catching the click that opened the popover
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", escHandler);
    });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg w-[240px] py-2"
      style={{ top: pos.top, right: pos.right }}
    >
      {/* Recording options */}
      <div className="px-3 py-1">
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">
          Recording
        </div>
        <label className="flex items-center gap-2 py-[5px] cursor-pointer group">
          <div
            onClick={onSkipCountdownToggle}
            className={`w-[30px] h-[16px] rounded-full flex items-center transition-colors cursor-pointer ${
              skipCountdown ? "bg-amber-400" : "bg-[var(--border)]"
            }`}
          >
            <div
              className={`w-[12px] h-[12px] rounded-full bg-white shadow-sm transition-transform ${
                skipCountdown ? "translate-x-[16px]" : "translate-x-[2px]"
              }`}
            />
          </div>
          <span className="text-[11.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
            Skip countdown
          </span>
        </label>
        <label className="flex items-center gap-2 py-[5px] cursor-pointer group">
          <div
            onClick={onRecordThroughToggle}
            className={`w-[30px] h-[16px] rounded-full flex items-center transition-colors cursor-pointer ${
              recordThrough ? "bg-red-400" : "bg-[var(--border)]"
            }`}
          >
            <div
              className={`w-[12px] h-[12px] rounded-full bg-white shadow-sm transition-transform ${
                recordThrough ? "translate-x-[16px]" : "translate-x-[2px]"
              }`}
            />
          </div>
          <span className="text-[11.5px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
            Record through
          </span>
        </label>
      </div>

      {/* Divider */}
      {((inputDevices && inputDevices.length > 0) || (outputDevices && outputDevices.length > 0)) && (
        <div className="mx-3 my-1 border-t border-[var(--border)]" />
      )}

      {/* Audio devices */}
      {((inputDevices && inputDevices.length > 0) || (outputDevices && outputDevices.length > 0)) && (
        <div className="px-3 py-1">
          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">
            Audio devices
          </div>

          {inputDevices && inputDevices.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-[5px] mb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                </svg>
                <span className="text-[10px] text-[var(--text-muted)]">Input</span>
              </div>
              <select
                value={selectedInputId ?? ""}
                onChange={(e) => onInputChange?.(e.target.value)}
                className="w-full text-[11px] bg-[var(--bg)] text-[var(--text-secondary)] border border-[var(--border)] rounded-[5px] px-[6px] py-[4px] outline-none cursor-pointer truncate"
              >
                <option value="">Default mic</option>
                {inputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
          )}

          {outputDevices && outputDevices.length > 0 && (
            <div>
              <div className="flex items-center gap-[5px] mb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 010 7.07" />
                </svg>
                <span className="text-[10px] text-[var(--text-muted)]">Output</span>
              </div>
              <select
                value={selectedOutputId ?? ""}
                onChange={(e) => onOutputChange?.(e.target.value)}
                className="w-full text-[11px] bg-[var(--bg)] text-[var(--text-secondary)] border border-[var(--border)] rounded-[5px] px-[6px] py-[4px] outline-none cursor-pointer truncate"
              >
                <option value="">Default speaker</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
