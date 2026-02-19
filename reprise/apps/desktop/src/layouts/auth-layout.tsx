import type { ReactNode } from "react";

interface AuthLayoutProps {
  leftContent: ReactNode;
  children: ReactNode;
}

export function AuthLayout({ leftContent, children }: AuthLayoutProps) {
  return (
    <div className="grid grid-cols-2 min-h-screen">
      {/* Left panel — dark */}
      <div className="relative overflow-hidden bg-[#111111] px-14 py-13 flex flex-col">
        {/* Decorative circles */}
        <div className="absolute -top-[100px] -right-[100px] w-80 h-80 rounded-full bg-[var(--theme)] opacity-[0.07] pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-60 h-60 rounded-full bg-[var(--theme)] opacity-[0.05] pointer-events-none" />

        {/* Logo */}
        <div className="font-serif text-[21px] text-white flex items-center gap-2">
          Reprise
          <span className="w-[7px] h-[7px] rounded-full bg-[var(--theme)] mb-0.5 shrink-0" />
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col justify-center py-16 pb-12">
          {leftContent}
        </div>

        {/* Footer */}
        <div className="text-xs text-white/[0.22]">
          &copy; 2025 Reprise &middot; Built for singers.
        </div>
      </div>

      {/* Right panel — light */}
      <div className="flex items-center justify-center px-14 py-13 bg-[var(--bg)] overflow-y-auto">
        <div className="w-full max-w-[370px] animate-fade-up">{children}</div>
      </div>
    </div>
  );
}
