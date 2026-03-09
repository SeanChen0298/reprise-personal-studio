export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <span className="text-5xl">⚙️</span>
      <h1 className="text-xl font-semibold text-[var(--color-text)]">Settings</h1>
      <p className="text-sm text-[var(--color-text-muted)]">Preferences will appear here.</p>
    </div>
  );
}
