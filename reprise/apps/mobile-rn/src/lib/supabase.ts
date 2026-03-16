import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Song, Line, HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce", // Required for mobile OAuth (PKCE via exchangeCodeForSession)
  },
});

// ─── Data fetching helpers ────────────────────────────────────────────────────

export async function fetchSongs(userId: string): Promise<Song[]> {
  const { data, error } = await supabase
    .from("songs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Song[];
}

export async function fetchSong(songId: string): Promise<Song | null> {
  const { data, error } = await supabase
    .from("songs")
    .select("*")
    .eq("id", songId)
    .single();
  if (error) return null;
  return data as Song;
}

export async function fetchHighlights(userId: string): Promise<HighlightType[]> {
  const { data } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();
  const hl = (data?.preferences as Record<string, unknown> | null)?.highlights;
  return Array.isArray(hl) && hl.length > 0 ? (hl as HighlightType[]) : DEFAULT_HIGHLIGHTS;
}

export async function fetchLines(songId: string): Promise<Line[]> {
  const { data, error } = await supabase
    .from("lines")
    .select("*")
    .eq("song_id", songId)
    .order("order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    // annotations may be stored as a legacy JSON string; normalise to array
    annotations: Array.isArray(row.annotations)
      ? row.annotations
      : typeof row.annotations === "string"
        ? JSON.parse(row.annotations)
        : [],
  })) as Line[];
}
