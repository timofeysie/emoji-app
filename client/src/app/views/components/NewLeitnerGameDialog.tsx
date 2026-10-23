import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, GraduationCap, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../../shared/button';
import { Checkbox } from '../../shared/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../shared/dialog';
import { Label } from '../../shared/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/select';
import { cn } from '../../shared/utils';
import {
  dueLabel,
  errorBody,
  errorText,
  LEITNER_ASPECTS,
  LEITNER_BOOK,
  levelLabel,
  PICK_REASONS,
  REASON_STYLES,
  type LeitnerScope,
  type PendingExport,
  type Plan,
  type Player,
  type Progress,
  type ProgressTrack,
} from '../leitner';

/** Placeholder creator ID used when no auth is wired. Must be a 24-char hex ObjectId. */
const DEMO_CREATOR_ID = '000000000000000000000001';
const DEFAULT_CHAPTER = '27';

type Chapter = { chapter: string; entryCount: number };

/** A refusal the referee can act on: open the blocking game. */
type Blocked = { message: string; gameIds: string[]; action: string };

type Preview = { plan: Plan; progress: Progress | null };

/**
 * Games → New Leitner game (docs/xAPI/leitner-method.md → Referee flow):
 * pick the student, chapter, scope and aspects, preview the plan (a dry
 * run plus the progress table), then create the game and open it.
 */
export function NewLeitnerGameDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [chapter, setChapter] = useState(DEFAULT_CHAPTER);
  const [scope, setScope] = useState<LeitnerScope>('chapter');
  const [aspects, setAspects] = useState<string[]>([...LEITNER_ASPECTS]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      const [playersRes, chaptersRes] = await Promise.all([
        fetch('/api/players', { credentials: 'same-origin' }),
        fetch(`/api/books/${LEITNER_BOOK}/chapters`, { credentials: 'same-origin' }),
      ]);
      if (playersRes.ok) {
        setPlayers(((await playersRes.json()) as { players: Player[] }).players);
      }
      if (chaptersRes.ok) {
        const loaded = ((await chaptersRes.json()) as { chapters: Chapter[] }).chapters;
        setChapters(loaded);
        setChapter((current) =>
          loaded.some((c) => c.chapter === current) ? current : (loaded[0]?.chapter ?? current),
        );
      }
    } catch {
      setError('Could not reach server.');
    }
  }, []);

  useEffect(() => {
    if (open) void loadOptions();
  }, [open, loadOptions]);

  // Any change makes the previewed plan stale.
  useEffect(() => {
    setPreview(null);
    setBlocked(null);
    setError(null);
  }, [playerId, chapter, scope, aspects]);

  const reset = () => {
    setPlayerId('');
    setScope('chapter');
    setAspects([...LEITNER_ASPECTS]);
    setPreview(null);
    setError(null);
    setBlocked(null);
  };

  const request = (extra: Record<string, unknown>) => ({
    playerId,
    book: LEITNER_BOOK,
    chapter,
    scope,
    aspects,
    ...extra,
  });

  /** 409s name the game that blocks planning; the referee resolves it there. */
  const handleRefusal = (status: number, body: Record<string, unknown>) => {
    if (status === 409 && Array.isArray(body['pendingExport'])) {
      const pending = body['pendingExport'] as PendingExport[];
      setBlocked({
        message: "This student's last Leitner game hasn't reached the LRS yet. Retry its export first, so the plan uses up-to-date levels.",
        gameIds: pending.map((game) => game.gameId),
        action: 'Open to retry export',
      });
      return;
    }
    if (status === 409 && Array.isArray(body['inPlay'])) {
      setBlocked({
        message: 'A Leitner game for this student is being played. End it first.',
        gameIds: body['inPlay'] as string[],
        action: 'Open game',
      });
      return;
    }
    if (status === 422 && Array.isArray(body['sourceRefs'])) {
      setError(`${errorText(body, status)}: ${(body['sourceRefs'] as string[]).join(', ')}`);
      return;
    }
    if (status === 503) {
      setError('The LRS is not configured on this server, so levels cannot be read.');
      return;
    }
    if (status === 502) {
      setError('The LRS request failed. Try again in a moment.');
      return;
    }
    setError(errorText(body, status));
  };

  const previewPlan = async () => {
    if (!playerId) {
      setError('Pick a student.');
      return;
    }
    setPlanning(true);
    setError(null);
    setBlocked(null);
    try {
      const query = new URLSearchParams({ book: LEITNER_BOOK, chapter, scope, aspects: aspects.join(',') });
      const [planRes, progressRes] = await Promise.all([
        fetch('/api/leitner-games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request({ dryRun: true })),
          credentials: 'same-origin',
        }),
        fetch(`/api/players/${playerId}/progress?${query}`, { credentials: 'same-origin' }),
      ]);
      if (!planRes.ok) {
        handleRefusal(planRes.status, await errorBody(planRes));
        return;
      }
      const { plan } = (await planRes.json()) as { plan: Plan };
      const progress = progressRes.ok ? ((await progressRes.json()) as Progress) : null;
      setPreview({ plan, progress });
    } catch {
      setError('Network error — could not plan the game.');
    } finally {
      setPlanning(false);
    }
  };

  const createGame = async () => {
    if (!preview) return;
    setCreating(true);
    setError(null);
    try {
      // The dry run's seed and now: the server re-plans to the same game.
      const res = await fetch('/api/leitner-games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          request({ createdByUserId: DEMO_CREATOR_ID, seed: preview.plan.seed, now: preview.plan.now }),
        ),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        handleRefusal(res.status, await errorBody(res));
        return;
      }
      const { gameId } = (await res.json()) as { gameId: string };
      setOpen(false);
      reset();
      navigate(`/games/${gameId}`);
    } catch {
      setError('Network error — could not create the game.');
    } finally {
      setCreating(false);
    }
  };

  const toggleAspect = (aspect: string, checked: boolean) => {
    setAspects((prev) =>
      checked ? LEITNER_ASPECTS.filter((a) => a === aspect || prev.includes(a)) : prev.filter((a) => a !== aspect),
    );
  };

  const picks = preview?.plan.picks ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <GraduationCap className="mr-1.5 h-4 w-4" aria-hidden />
          New Leitner Game
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Leitner Game</DialogTitle>
          <DialogDescription>
            A single-use game of one student&apos;s next due words. It exports itself when it ends,
            then it&apos;s deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leitner-student">Student</Label>
            <Select value={playerId || undefined} onValueChange={setPlayerId}>
              <SelectTrigger id="leitner-student">
                <SelectValue placeholder={players.length ? 'Pick a student…' : 'No players yet'} />
              </SelectTrigger>
              <SelectContent>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.firstName}
                    <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
                      {player.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leitner-chapter">Chapter</Label>
            <Select value={chapter} onValueChange={setChapter}>
              <SelectTrigger id="leitner-chapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(chapters.length ? chapters : [{ chapter, entryCount: 0 }]).map((c) => (
                  <SelectItem key={c.chapter} value={c.chapter}>
                    Chapter {c.chapter}
                    {c.entryCount > 0 && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {c.entryCount} words
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leitner-scope">Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as LeitnerScope)}>
              <SelectTrigger id="leitner-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chapter">This chapter only</SelectItem>
                <SelectItem value="review">This chapter + review</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {scope === 'review'
                ? 'Adds due words from other chapters this student has played.'
                : "Only this chapter's words."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Aspects</Label>
            <div className="flex h-9 items-center gap-4">
              {LEITNER_ASPECTS.map((aspect) => (
                <label key={aspect} className="flex items-center gap-1.5 text-sm capitalize">
                  <Checkbox
                    checked={aspects.includes(aspect)}
                    disabled={aspects.length === 1 && aspects.includes(aspect)}
                    onCheckedChange={(checked) => toggleAspect(aspect, checked === true)}
                  />
                  {aspect}
                </label>
              ))}
            </div>
          </div>
        </div>

        {blocked && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {blocked.message}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {blocked.gameIds.map((gameId) => (
                <Button
                  key={gameId}
                  size="sm"
                  variant="outline"
                  className="h-7 bg-background text-xs"
                  onClick={() => {
                    setOpen(false);
                    reset();
                    navigate(`/games/${gameId}`);
                  }}
                >
                  {blocked.action}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {preview && <PlanPreview preview={preview} />}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant={preview ? 'outline' : 'default'}
            onClick={() => void previewPlan()}
            disabled={planning || creating || !playerId}
          >
            {planning && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {preview ? 'Re-plan' : 'Preview Plan'}
          </Button>
          <Button
            onClick={() => void createGame()}
            disabled={!preview || picks.length === 0 || creating || planning}
            title={!preview ? 'Preview the plan first' : picks.length === 0 ? 'Nothing to ask' : undefined}
          >
            {creating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            Create
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonChip({ reason }: { reason: keyof typeof REASON_STYLES }) {
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', REASON_STYLES[reason])}>
      {reason}
    </span>
  );
}

function PlanPreview({ preview }: { preview: Preview }) {
  const { plan, progress } = preview;
  const pickedText = PICK_REASONS.filter((reason) => plan.report.picked[reason] > 0)
    .map((reason) => `${plan.report.picked[reason]} ${reason}`)
    .join(', ');

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {progress && <ProgressSummary progress={progress} />}

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold">
          {plan.picks.length === 0 ? 'Nothing to ask' : `Picked ${plan.picks.length}`}
          {pickedText && <span className="font-normal text-muted-foreground">: {pickedText}</span>}
        </p>
        {plan.picks.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Every word in scope is retired or not due yet.
            {plan.scope === 'chapter'
              ? ' Try "This chapter + review", or the next chapter.'
              : ' Try the next chapter.'}
          </p>
        ) : (
          <ol className="flex flex-col divide-y rounded-md border text-sm">
            {plan.picks.map((pick, index) => (
              <li
                key={`${pick.learningObjectId}:${pick.aspect}`}
                className="flex items-center gap-2 px-2.5 py-1.5"
              >
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{pick.word}</span>{' '}
                  <span className="text-muted-foreground">{pick.gloss}</span>
                </span>
                <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{pick.aspect}</span>
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {pick.status === 'new' ? '' : levelLabel(pick)}
                </span>
                <ReasonChip reason={pick.reason} />
                {pick.chapter && pick.chapter !== plan.chapter && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">ch. {pick.chapter}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {plan.report.skipped.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Skipped {plan.report.skipped.length} that couldn&apos;t be made into a question.
          </p>
        )}
        {plan.supersedes.length > 0 && (
          <p className="text-[11px] text-amber-800">
            Creating replaces {plan.supersedes.length} unplayed or cancelled Leitner game
            {plan.supersedes.length === 1 ? '' : 's'} for this student.
          </p>
        )}
        <p className="text-[10px] tabular-nums text-muted-foreground">
          Seed {plan.seed} · as of {new Date(plan.now).toLocaleString()}
        </p>
      </div>

      {progress && progress.tracks.length > 0 && <ProgressTable progress={progress} />}
    </div>
  );
}

function ProgressSummary({ progress }: { progress: Progress }) {
  const { summary } = progress;
  const cells: Array<[string, number]> = [
    ['new', summary.new],
    ['L0', summary.active.L0],
    ['L1', summary.active.L1],
    ['L2', summary.active.L2],
    ['L3', summary.active.L3],
    ['retired', summary.retired],
    ['due', summary.due],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-semibold">
        {progress.player.label}
        <span className="font-normal text-muted-foreground"> · {progress.tracks.length} tracks</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {cells.map(([label, value]) => (
          <span key={label} className="rounded-md border px-2 py-1 text-xs">
            <span className="font-semibold tabular-nums">{value}</span>{' '}
            <span className="text-muted-foreground">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Word × aspect, like `create:leitner-game --report`. */
function ProgressTable({ progress }: { progress: Progress }) {
  const rows = useMemo(() => {
    const byObject = new Map<string, { word: string; gloss: string; inChapter: boolean; byAspect: Map<string, ProgressTrack> }>();
    for (const track of progress.tracks) {
      const row = byObject.get(track.learningObjectId) ?? {
        word: track.word ?? track.learningObjectId,
        gloss: track.gloss ?? '',
        inChapter: track.inChapter,
        byAspect: new Map<string, ProgressTrack>(),
      };
      row.byAspect.set(track.aspect, track);
      byObject.set(track.learningObjectId, row);
    }
    return [...byObject.entries()];
  }, [progress]);

  return (
    <details className="rounded-md border text-sm">
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium">Progress table</summary>
      <div className="max-h-64 overflow-auto border-t">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-muted-foreground">
              <th className="px-2.5 py-1 font-medium">Word</th>
              {progress.aspects.map((aspect) => (
                <th key={aspect} className="px-2.5 py-1 font-medium capitalize">
                  {aspect}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, row]) => (
              <tr key={id} className="border-t">
                <td className="px-2.5 py-1">
                  <span className="font-medium">{row.word}</span>{' '}
                  <span className="text-muted-foreground">{row.gloss}</span>
                  {!row.inChapter && (
                    <span className="ml-1 text-[10px] text-violet-700">review</span>
                  )}
                </td>
                {progress.aspects.map((aspect) => {
                  const track = row.byAspect.get(aspect);
                  return (
                    <td key={aspect} className="px-2.5 py-1 tabular-nums">
                      {track ? (
                        <span
                          className={cn(
                            track.status === 'retired' && 'text-emerald-700',
                            track.status === 'new' && 'text-sky-700',
                            track.due && track.status === 'active' && 'font-semibold',
                          )}
                        >
                          {levelLabel(track)}
                          {dueLabel(track) && (
                            <span className="ml-1 font-normal text-muted-foreground">{dueLabel(track)}</span>
                          )}
                          {track.lastResult === 'incorrect' && (
                            <span className="ml-1 text-red-600" title="Last answer was wrong">
                              ✗
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
