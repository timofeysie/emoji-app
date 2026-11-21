import { cn } from '../shared/utils';
import type { ChatContextReading } from './useChatContextUsage';

const AMBER_FROM = 0.5;
const RED_FROM = 0.8;

/** 950 → "950", 12_400 → "12.4k", 1_047_576 → "1.05M". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${Number((tokens / 1000).toFixed(1))}k`;
  return `${Number((tokens / 1_000_000).toFixed(2))}M`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

/**
 * How full the chat's context is (docs/hashbrown/creating-games-with-hashbrown.md
 * → Context indicator). The bar follows whichever is closer to its limit:
 * the model's token window or the `/api/chat` body size.
 */
export function ContextMeter({ reading }: { reading: ChatContextReading | null }) {
  if (!reading) {
    return <p className="text-xs text-foreground/50">Context: counted after the first answer</p>;
  }

  const tokenShare = reading.contextWindow ? reading.totalTokens / reading.contextWindow : 0;
  const byteShare = reading.requestBytes / reading.bodyLimitBytes;
  const share = Math.min(1, Math.max(tokenShare, byteShare));
  const level = share >= RED_FROM ? 'red' : share >= AMBER_FROM ? 'amber' : 'ok';

  const tokens = reading.contextWindow
    ? `${formatTokens(reading.totalTokens)} / ${formatTokens(reading.contextWindow)} tokens (${Math.round(tokenShare * 100)}%)`
    : `${formatTokens(reading.totalTokens)} tokens`;
  const size =
    byteShare > tokenShare && byteShare >= AMBER_FROM
      ? ` · request ${formatBytes(reading.requestBytes)} of ${formatBytes(reading.bodyLimitBytes)}`
      : '';
  const details = [
    `System prompt and tools: ${formatTokens(reading.fixedTokens)} tokens`,
    `Messages: ${formatTokens(reading.messageTokens)} tokens`,
    `Last reply: ${formatTokens(reading.replyTokens)} tokens`,
    `Request size: ${formatBytes(reading.requestBytes)} of ${formatBytes(reading.bodyLimitBytes)}`,
    `Model: ${reading.model}. Estimated with the model's tokenizer.`,
  ].join('\n');

  return (
    <div className="flex flex-col gap-1" title={details} data-testid="chat-context-meter" data-level={level}>
      <div
        className="h-1 w-full overflow-hidden rounded bg-foreground/10"
        role="meter"
        aria-label="Chat context used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div
          className={cn(
            'h-full rounded',
            level === 'red' ? 'bg-red-500' : level === 'amber' ? 'bg-amber-500' : 'bg-foreground/40',
          )}
          style={{ width: `${Math.max(share * 100, 1)}%` }}
        />
      </div>
      <p className={cn('text-xs', level === 'red' ? 'text-red-600' : level === 'amber' ? 'text-amber-600' : 'text-foreground/50')}>
        Context ≈ {tokens}
        {size}
      </p>
    </div>
  );
}
