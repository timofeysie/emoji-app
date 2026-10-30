import { useState, type ReactNode } from 'react';
import { cn } from '../../shared/utils';

type RevealProps = {
  /** Always shown (usually the target language). */
  front: ReactNode;
  /** Shown on tap (usually the translation or answer). */
  back: ReactNode;
  frontLang?: string;
  /** Show the back without a tap (a section's "show all" switch). */
  revealed?: boolean;
  className?: string;
};

/** A tap-to-reveal card, like language-learning-app's expanding word and dialog rows. */
export function Reveal({ front, back, frontLang, revealed = false, className }: RevealProps) {
  const [open, setOpen] = useState(false);
  const shown = revealed || open;

  return (
    <button
      type="button"
      aria-expanded={shown}
      onClick={() => setOpen((value) => !value)}
      className={cn('w-full rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent', className)}
    >
      <div lang={frontLang}>{front}</div>
      {shown && <div className="mt-1 text-sm text-muted-foreground">{back}</div>}
    </button>
  );
}

/** "Show English" switch for a whole section. */
export function RevealAllToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
