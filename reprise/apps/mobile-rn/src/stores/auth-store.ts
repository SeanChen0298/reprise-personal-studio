import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

interface AuthStore {
  user: User | null;
  session: Session | null;
  loading: boolean;

  /** Call once at app start. Returns the unsubscribe function. */
  initialize: () => () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  session: null,
  loading: true,

  initialize() {
    // Get the initial session (resolves from AsyncStorage)
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, user: session?.user ?? null, loading: false });
    });

    // Subscribe to future changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        set({ session, user: session?.user ?? null, loading: false });
      }
    );

    return () => subscription.unsubscribe();
  },

  async signOut() {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));
