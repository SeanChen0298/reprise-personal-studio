export function RecordingsBar() {
  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] font-medium tracking-[0.09em] uppercase text-[var(--text-muted)]">
          Your recordings
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">0 takes</span>
      </div>
      <div className="text-[12.5px] text-[var(--text-muted)] py-4 text-center">
        Recording coming soon
      </div>
    </div>
  );
}
