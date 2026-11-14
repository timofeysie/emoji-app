import { BookOpen, Check, Ear, Mic, PenLine, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../shared/utils';
import type { AspectCounts, Level, PendingExport, ProgressTrack } from './yalla-progress';

type AspectInfo = {
  aspect: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
};

/** The four language-learning-app pills, in their old order. Listening and speaking have no evidence yet. */
export const ASPECTS: readonly AspectInfo[] = [
  { aspect: 'reading', label: 'Reading', icon: BookOpen, enabled: true },
  { aspect: 'writing', label: 'Writing', icon: PenLine, enabled: true },
  { aspect: 'listening', label: 'Listening', icon: Ear, enabled: false },
  { aspect: 'speaking', label: 'Speaking', icon: Mic, enabled: false },
];

export function aspectLabel(aspect: string): string {
  return ASPECTS.find((info) => info.aspect === aspect)?.label ?? aspect;
}

type AspectPillsProps = {
  /** null = no progress to show (no linked player, or it couldn't load): every pill shows "–". */
  counts: Record<string, AspectCounts> | null;
  /** Why `counts` is null, as a tooltip. */
  emptyReason?: string;
  /** Makes each enabled pill a link (e.g. to the vocabulary filtered by that aspect). */
  hrefFor?: (aspect: string) => string;
  /** The pill shown as selected. */
  selected?: string | null;
  compact?: boolean;
  /** Only these aspects get a pill (e.g. the ones a running practice session covers). Default: every enabled one. */
  aspects?: readonly string[] | null;
};

/**
 * Reading / writing / listening / speaking pills (docs/yalla/implementation-plan.md §5):
 * words still to learn (not retired) and how many of them are due now.
 */
export function AspectPills({
  counts,
  emptyReason,
  hrefFor,
  selected = null,
  compact = false,
  aspects = null,
}: AspectPillsProps) {
  // Aspects that are not practised yet (listening, speaking) get no pill at all.
  const shown = ASPECTS.filter(({ aspect, enabled }) => enabled && (!aspects || aspects.includes(aspect)));
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Progress by skill">
      {shown.map(({ aspect, label, icon: Icon }) => {
        const count = counts?.[aspect];
        const title = count
          ? `${label}: ${count.open} of ${count.total} words still to learn, ${count.due} due now`
          : `${label}: ${emptyReason ?? 'no progress yet'}`;
        const body = (
          <>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {!compact && <span>{label}</span>}
            {count ? (
              <span className="tabular-nums">
                <strong className="font-semibold">{count.open}</strong>
                {count.due > 0 && <span className="text-muted-foreground"> · {count.due} due</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">–</span>
            )}
          </>
        );
        const className = cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
          selected === aspect && 'border-primary bg-primary/10 text-primary',
        );
        return (
          <li key={aspect} data-testid={`pill-${aspect}`}>
            {count && hrefFor ? (
              <Link to={hrefFor(aspect)} title={title} className={cn(className, 'hover:bg-accent')}>
                {body}
              </Link>
            ) : (
              <span title={title} className={className}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One word's level on one aspect: three dots (L1–L3), a tick once retired, amber when a review is due. */
export function LevelDots({ track }: { track: ProgressTrack }) {
  const label = aspectLabel(track.aspect);
  const state =
    track.status === 'retired'
      ? 'learned'
      : track.status === 'new'
        ? 'new'
        : `level ${track.level}${track.due ? ', due now' : ''}`;
  return (
    <span
      className="flex items-center gap-1 text-[10px] text-muted-foreground"
      title={`${label}: ${state}`}
      aria-label={`${label}: ${state}`}
      data-testid={`level-${track.aspect}`}
      data-level={track.status === 'retired' ? 'retired' : track.level}
    >
      {/* Amber marks a review that's due; new words are always due, so they stay plain. */}
      <span className={cn('font-semibold', track.status === 'active' && track.due && 'text-amber-600')}>
        {label[0]}
      </span>
      {track.status === 'retired' ? (
        <Check className="h-3 w-3 text-emerald-600" aria-hidden />
      ) : (
        ([1, 2, 3] as Level[]).map((level) => (
          <span
            key={level}
            className={cn('h-1.5 w-1.5 rounded-full border border-current', track.level >= level && 'bg-current')}
          />
        ))
      )}
    </span>
  );
}

/** Badge-game evidence reaches the LRS only on export, so levels may lag behind until then. */
export function PendingExportNotice({ pending }: { pending: readonly PendingExport[] }) {
  if (pending.length === 0) return null;
  const games = pending.length === 1 ? '1 badge game has' : `${pending.length} badge games have`;
  return (
    <p
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-testid="pending-export"
    >
      {games} not been sent to the LRS yet, so these levels may be out of date.
    </p>
  );
}
