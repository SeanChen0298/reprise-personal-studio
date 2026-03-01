interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-[var(--surface)] rounded-[12px] border border-[var(--border)] shadow-2xl w-full max-w-[400px] p-6 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-medium tracking-[-0.2px] mb-2">{title}</h2>
        <p className="text-[13.5px] text-[var(--text-muted)] leading-relaxed mb-6">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-opacity hover:opacity-80 cursor-pointer border-none ${
              destructive ? "bg-red-600" : "bg-[var(--accent)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
