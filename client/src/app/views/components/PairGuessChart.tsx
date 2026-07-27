import { Loader2 } from 'lucide-react';
import { cn } from '../../shared/utils';

export type GuessChartCell = {
  cardLabel: string;
  slotLabel: string;
  isCorrect: boolean;
  cardUid?: string;
};

export type GuessChartQuestion = {
  questionId: string;
  sequence: number;
  byPair: Record<string, GuessChartCell | null>;
};

export type GuessChartData = {
  gameId: string;
  title: string;
  pairs: string[];
  questions: GuessChartQuestion[];
};

function pairTotals(
  questions: GuessChartQuestion[],
  pairName: string,
): { correct: number; total: number } {
  const total = questions.length;
  let correct = 0;
  for (const q of questions) {
    if (q.byPair[pairName]?.isCorrect) {
      correct += 1;
    }
  }
  return { correct, total };
}

export function PairGuessChart({
  chart,
  loading,
}: {
  chart: GuessChartData | null;
  loading: boolean;
}) {
  const pairs = chart?.pairs ?? [];
  const questions = chart?.questions ?? [];

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Result
      </p>
      {loading && !chart ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : pairs.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No bound pairs yet.</p>
      ) : questions.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No questions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[12rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Question</th>
                {pairs.map((pairName) => (
                  <th key={pairName} className="px-2 py-1 font-medium capitalize">
                    {pairName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.questionId} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 font-medium tabular-nums">Q{q.sequence}</td>
                  {pairs.map((pairName) => {
                    const cell = q.byPair[pairName];
                    const label = cell?.cardLabel ?? '-';
                    return (
                      <td
                        key={pairName}
                        className={cn(
                          'px-2 py-1.5 capitalize',
                          cell == null && 'text-muted-foreground',
                          cell?.isCorrect === true && 'text-green-700',
                          cell?.isCorrect === false && 'text-red-700',
                        )}
                        title={
                          cell
                            ? `slot ${cell.slotLabel}${cell.isCorrect ? ' · correct' : ' · wrong'}`
                            : 'No guess'
                        }
                      >
                        {label}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t text-[11px] text-muted-foreground">
                <td className="py-1.5 pr-3 font-semibold uppercase tracking-wide">
                  Total
                </td>
                {pairs.map((pairName) => {
                  const { correct, total } = pairTotals(questions, pairName);
                  return (
                    <td
                      key={pairName}
                      className="px-2 py-1.5 font-medium tabular-nums text-foreground"
                    >
                      {correct} / {total}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
