import { supabase } from "./supabase";
import { usePreferencesStore } from "../stores/preferences-store";
import { useHighlightStore, type HighlightType } from "./highlight-config";
import { useSymbolStore, type VocalSymbol } from "./symbol-config";

// Module-level state for managing save subscriptions
let _unsubscribers: Array<() => void> = [];
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function savePreferences(userId: string): Promise<void> {
  const { theme, showWaveform } = usePreferencesStore.getState();
  const { highlights } = useHighlightStore.getState();
  const { symbols } = useSymbolStore.getState();

  await supabase
    .from("profiles")
    .update({
      preferences: { theme, showWaveform, highlights, symbols },
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

export async function loadPreferences(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();

  if (error || !data?.preferences) return;

  const p = data.preferences as {
    theme?: string;
    showWaveform?: boolean;
    highlights?: HighlightType[];
    symbols?: VocalSymbol[];
  };

  const { setTheme, setShowWaveform } = usePreferencesStore.getState();
  const { setHighlights } = useHighlightStore.getState();
  const { setSymbols } = useSymbolStore.getState();

  if (p.theme) setTheme(p.theme);
  if (typeof p.showWaveform === "boolean") setShowWaveform(p.showWaveform);
  if (Array.isArray(p.highlights) && p.highlights.length > 0) setHighlights(p.highlights);
  if (Array.isArray(p.symbols) && p.symbols.length > 0) setSymbols(p.symbols);
}

// Start watching all preference stores and debounce-saving on any change.
// Call loadPreferences BEFORE startPrefSync to avoid a write-on-read cycle.
export function startPrefSync(userId: string): void {
  stopPrefSync();

  const scheduleSave = () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => savePreferences(userId), 800);
  };

  _unsubscribers = [
    usePreferencesStore.subscribe(scheduleSave),
    useHighlightStore.subscribe(scheduleSave),
    useSymbolStore.subscribe(scheduleSave),
  ];
}

export function stopPrefSync(): void {
  _unsubscribers.forEach((fn) => fn());
  _unsubscribers = [];
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
}
