import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./index.css";

// TEMPORARY: expose the one-time Supabase→local migration on the devtools
// console as window.__repriseMigrate(). Remove once migration is complete.
if (import.meta.env.DEV) {
  import("./lib/migrate-from-supabase").then(({ migrateFromSupabase }) => {
    (window as unknown as { __repriseMigrate: typeof migrateFromSupabase }).__repriseMigrate =
      migrateFromSupabase;
    console.log("[migrate] run: await window.__repriseMigrate('you@email.com', 'your-password') once to import cloud data.");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
