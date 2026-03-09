import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Factory used by each app to create the typed Supabase client.
// Pass VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from import.meta.env.
export function createSupabaseClient(supabaseUrl: string, supabaseAnonKey: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<Database>(supabaseUrl, supabaseAnonKey) as any;
}
