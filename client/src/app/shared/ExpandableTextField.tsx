import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from './utils';

type ExpandableTextFieldProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  'aria-label': string;
  /** Shown as "52 / 120" while expanded. */
  maxLength?: number;
  className?: string;
};

/**
 * A one-line text field that never hides its text: when the text is too long
 * for the line it ends in an ellipsis, and a click or tap expands it to show
 * (and edit) all of it. Clicking the chevron, or leaving the field, collapses it.
 * Used where reviewers must see every word, e.g. drafted questions and options.
 */
export function ExpandableTextField({
  value,
  onChange,
  readOnly = false,
  placeholder,
  'aria-label': ariaLabel,
  maxLength,
  className,
}: ExpandableTextFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const lineRef = useRef<HTMLSpanElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Whether the collapsed line cuts the text off, so the chevron only shows when it does.
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (expanded || !line) return;
    const measure = () => setOverflowing(line.scrollWidth > line.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [value, expanded]);

  // The expanded box grows with its text.
  const fit = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, []);
  useLayoutEffect(() => {
    if (expanded) fit();
  }, [expanded, value, fit]);

  const box =
    'w-full rounded-md border border-input bg-transparent px-3 text-base shadow-sm md:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  if (expanded) {
    return (
      <div className={cn('relative', className)}>
        {readOnly ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={`${ariaLabel} (tap to collapse)`}
            aria-expanded
            className={cn(box, 'cursor-pointer whitespace-pre-wrap break-words py-2 pr-9')}
            onClick={() => setExpanded(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
                event.preventDefault();
                setExpanded(false);
              }
            }}
          >
            {value || <span className="text-muted-foreground">{placeholder}</span>}
          </div>
        ) : (
          <textarea
            ref={areaRef}
            autoFocus
            rows={1}
            aria-label={ariaLabel}
            aria-expanded
            placeholder={placeholder}
            className={cn(box, 'block resize-none overflow-hidden py-2 pr-9 placeholder:text-muted-foreground')}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            onFocus={(event) => {
              const end = event.target.value.length;
              event.target.setSelectionRange(end, end);
            }}
            onBlur={() => setExpanded(false)}
            onKeyDown={(event) => {
              // One line of text: Enter or Escape finishes editing.
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                setExpanded(false);
              }
            }}
          />
        )}
        <button
          type="button"
          className="absolute right-2 top-2 text-muted-foreground"
          aria-label={`Collapse ${ariaLabel}`}
          // Keep the textarea's blur from racing the click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setExpanded(false)}
        >
          <ChevronUp className="h-4 w-4" aria-hidden />
        </button>
        {maxLength !== undefined && (
          <p className={cn('mt-0.5 text-right text-[11px]', value.length > maxLength ? 'text-destructive' : 'text-muted-foreground')}>
            {value.length} / {maxLength}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={readOnly ? `${ariaLabel}: ${value}` : `Edit ${ariaLabel}: ${value}`}
      aria-expanded={false}
      title={overflowing ? value : undefined}
      className={cn(box, 'flex h-9 cursor-text items-center gap-1', readOnly && 'cursor-pointer', className)}
      onClick={() => setExpanded(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setExpanded(true);
        }
      }}
    >
      <span ref={lineRef} className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
        {value || placeholder}
      </span>
      {overflowing && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
    </div>
  );
}
