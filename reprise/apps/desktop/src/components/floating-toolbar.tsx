import type { HighlightType } from "../lib/highlight-config";
import type { VocalSymbol } from "../lib/symbol-config";

interface Props {
  highlights: HighlightType[];
  symbols: VocalSymbol[];
  onHighlight: (typeId: string) => void;
  onInsertSymbol: (char: string) => void;
  onRemoveAnnotation?: () => void;
  onClose: () => void;
}

export function FloatingToolbar({
  highlights, symbols, onHighlight, onInsertSymbol, onRemoveAnnotation,
}: Props) {
  return (
    <div className="flex justify-center mt-3">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[8px] px-2 py-[6px] flex flex-col gap-[4px]">
        {/* Highlights row */}
        <div className="flex items-center gap-[4px]">
          {highlights.map((hl) => (
            <button
              key={hl.id}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onHighlight(hl.id); }}
              className="text-[10px] font-medium px-[7px] py-[3px] rounded-[4px] border-none cursor-pointer transition-all hover:scale-105 flex items-center gap-[3px]"
              style={{ backgroundColor: hl.bg, color: hl.color }}
              title={hl.name}
            >
              <span
                className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                style={{ backgroundColor: hl.color }}
              />
              {hl.name}
            </button>
          ))}
          {onRemoveAnnotation && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveAnnotation(); }}
              className="text-[10px] font-medium px-[6px] py-[3px] rounded-[4px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer hover:border-red-300 hover:text-red-500 transition-all"
              title="Remove highlight"
            >
              ✕
            </button>
          )}
        </div>

        {/* Symbols row */}
        {symbols.length > 0 && (
          <div className="flex items-center gap-[3px] border-t border-[var(--border)] pt-[4px]">
            <span className="text-[9px] text-[var(--text-muted)] mr-[2px]">Insert:</span>
            {symbols.map((sym) => (
              <button
                key={sym.id}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onInsertSymbol(sym.char); }}
                title={sym.label}
                className="text-[13px] w-6 h-6 rounded-[4px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[var(--theme)] hover:text-[var(--theme)] transition-all"
              >
                {sym.char}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
