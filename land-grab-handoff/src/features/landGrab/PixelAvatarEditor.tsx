import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AVATAR_SIZE, createEmptyAvatar, isBlankAvatar, type AvatarGrid } from "./pixelAvatar";

/** Quick-pick swatches shown above the custom color input. */
const PALETTE = [
  "#f8fafc",
  "#0f172a",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#4ade80",
  "#22d3ee",
  "#38bdf8",
  "#818cf8",
  "#e879f9",
];

/** Transparent-cell checkerboard, so "no pixel" reads differently than "black pixel". */
const TRANSPARENT_CELL_STYLE: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #64748b 25%, transparent 25%), linear-gradient(-45deg, #64748b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #64748b 75%), linear-gradient(-45deg, transparent 75%, #64748b 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
  backgroundColor: "#334155",
};

export interface PixelAvatarEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved avatar, or `null` if the player hasn't designed one yet. */
  value: AvatarGrid | null;
  /** Player's plain marker color (as `#rrggbb`), used to seed the first pixel painted. */
  seedColor: string;
  /** Called on Save with the drawn grid, or `null` if it was cleared back to blank (falls back to the color circle). */
  onSave: (grid: AvatarGrid | null) => void;
}

/** A small 8x8 pixel-art editor for the human player's in-game head marker. */
export function PixelAvatarEditor({ open, onOpenChange, value, seedColor, onSave }: PixelAvatarEditorProps) {
  const [draft, setDraft] = useState<AvatarGrid>(() => value ?? createEmptyAvatar());
  const [paintColor, setPaintColor] = useState(seedColor);
  const [erasing, setErasing] = useState(false);
  const isPointerDownRef = useRef(false);

  // Re-seed the draft from the saved value (or a blank grid) each time the editor opens.
  useEffect(() => {
    if (open) setDraft(value ?? createEmptyAvatar());
  }, [open, value]);

  const paintCell = (index: number) => {
    setDraft((prev) => {
      const next = prev.slice();
      next[index] = erasing ? null : paintColor;
      return next;
    });
  };

  const handleSave = () => {
    onSave(isBlankAvatar(draft) ? null : draft);
    onOpenChange(false);
  };

  const handleClear = () => setDraft(createEmptyAvatar());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Design your avatar</DialogTitle>
          <DialogDescription>
            Paint an 8×8 sprite for your boat's head marker in the game. Leave a pixel blank to keep it transparent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <div
            className="grid gap-px bg-border p-px rounded-md select-none"
            style={{ gridTemplateColumns: `repeat(${AVATAR_SIZE}, 1.75rem)` }}
            onMouseLeave={() => (isPointerDownRef.current = false)}
            data-testid="pixel-avatar-grid"
          >
            {draft.map((cellColor, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Pixel ${Math.floor(index / AVATAR_SIZE) + 1}, ${(index % AVATAR_SIZE) + 1}`}
                className="w-7 h-7"
                style={cellColor ? { backgroundColor: cellColor } : TRANSPARENT_CELL_STYLE}
                onMouseDown={() => {
                  isPointerDownRef.current = true;
                  paintCell(index);
                }}
                onMouseEnter={() => {
                  if (isPointerDownRef.current) paintCell(index);
                }}
                onMouseUp={() => (isPointerDownRef.current = false)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 w-full">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use color ${color}`}
                onClick={() => {
                  setPaintColor(color);
                  setErasing(false);
                }}
                className="w-5 h-5 rounded-full border border-border/60"
                style={{
                  backgroundColor: color,
                  outline: !erasing && paintColor === color ? "2px solid hsl(var(--ring))" : undefined,
                  outlineOffset: 2,
                }}
              />
            ))}
            <input
              type="color"
              value={paintColor}
              onChange={(e) => {
                setPaintColor(e.target.value);
                setErasing(false);
              }}
              className="w-7 h-7 rounded border border-border bg-transparent p-0"
              aria-label="Custom color"
            />
            <button
              type="button"
              onClick={() => setErasing((e) => !e)}
              aria-pressed={erasing}
              className={
                "ml-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors " +
                (erasing
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:opacity-90")
              }
            >
              Eraser
            </button>
            <button
              onClick={handleClear}
              type="button"
              className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Clear
            </button>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Save avatar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
