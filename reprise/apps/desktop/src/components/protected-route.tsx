import type { ReactNode } from "react";

// Offline app: there is no auth gate, so this is a pass-through. Kept as a
// component so route definitions don't need to change.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
