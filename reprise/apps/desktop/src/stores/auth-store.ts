import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useSongStore } from "./song-store";
import { loadPreferences, startPrefSync, stopPrefSync } from "../lib/sync-preferences";

interface AuthStore {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      set({ session, user: session?.user ?? null, loading: false });

      // If already logged in on app launch, load data immediately
      if (session?.user) {
        useSongStore.getState().loadAllData();
        await loadPreferences(session.user.id);
        startPrefSync(session.user.id);
      }
    } catch (err) {
      console.error("Failed to initialize auth:", err);
      set({ loading: false });
    }

    supabase.auth.onAuthStateChange((_event: string, session: import("@supabase/supabase-js").Session | null) => {
      set({ session, user: session?.user ?? null });

      if (session?.user) {
        // User just signed in — load their data
        useSongStore.getState().loadAllData();
        loadPreferences(session.user.id).then(() => startPrefSync(session.user.id));
      } else {
        // User signed out — clear song data and stop syncing preferences
        useSongStore.getState().clearData();
        stopPrefSync();
      }
    });
  },

  signInWithEmail: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { set({ error: error.message }); throw error; }
  },

  signUpWithEmail: async (email, password) => {
    set({ error: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { set({ error: error.message }); throw error; }
    return { needsConfirmation: !data.session };
  },

  signInWithGoogle: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
    if (error) { set({ error: error.message }); throw error; }
  },

  resetPassword: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) { set({ error: error.message }); throw error; }
  },

  signOut: async () => {
    stopPrefSync();
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },

  clearError: () => set({ error: null }),
}));