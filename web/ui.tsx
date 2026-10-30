import { useRef, useState, type ReactNode } from "react";
import { navigate, type Valence } from "./lib";

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Score({ score, valence }: { score: number; valence: Valence }) {
  return <span className={`score ${valence}`}>{score.toFixed(1)}</span>;
}

// Looks like plain text; click to edit. Enter saves, Escape cancels.
export function Editable({
  value,
  onSave,
  className,
  placeholder,
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  className?: string;
  // Shown while empty (e.g. a note added from an experience page).
  placeholder?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const el = ref.current!;
    const next = el.innerText.trim();
    if (!next || next === value) {
      el.innerText = value;
      return;
    }
    try {
      setError(null);
      await onSave(next);
    } catch (e) {
      el.innerText = value;
      setError((e as Error).message);
    }
  }

  return (
    <>
      <span
        ref={ref}
        className={`editable ${className ?? ""}`}
        data-placeholder={placeholder}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.innerText = value;
            e.currentTarget.blur();
          }
        }}
      >
        {value}
      </span>
      {error && <span className="error"> {error}</span>}
    </>
  );
}
