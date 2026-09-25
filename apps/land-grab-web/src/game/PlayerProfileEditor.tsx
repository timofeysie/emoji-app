import { useId, useState } from "react";
import { AVATAR_SIZE, type AvatarGrid } from "@emoji-app/land-grab-core";
import { PixelAvatarEditor } from "./PixelAvatarEditor";
import { DEFAULT_USERNAME, MAX_USERNAME_LENGTH } from "./userProfile";

export interface PlayerAvatarPreviewProps {
  avatar: AvatarGrid | null;
  seedColor: string;
  size?: number;
}

/** The avatar currently used in-game, including the default circle when no sprite has been saved. */
export function PlayerAvatarPreview({ avatar, seedColor, size = 48 }: PlayerAvatarPreviewProps) {
  if (!avatar) {
    return (
      <span
        role="img"
        aria-label="Current default avatar"
        className="inline-block shrink-0 rounded-full border-[3px] bg-white"
        style={{ width: size, height: size, borderColor: seedColor }}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label="Current custom avatar"
      className="grid shrink-0 overflow-hidden rounded-md border border-border bg-background"
      style={{ width: size, height: size, gridTemplateColumns: `repeat(${AVATAR_SIZE}, 1fr)` }}
    >
      {avatar.map((color, index) => (
        <span key={index} style={{ backgroundColor: color ?? "transparent" }} />
      ))}
    </div>
  );
}

export interface PlayerProfileEditorProps {
  username: string;
  avatar: AvatarGrid | null;
  seedColor: string;
  onUsernameChange: (value: string) => void;
  onAvatarChange: (avatar: AvatarGrid | null) => void;
  className?: string;
}

/** Shared name and avatar controls used by both the Profiles page and first-run setup. */
export function PlayerProfileEditor({
  username,
  avatar,
  seedColor,
  onUsernameChange,
  onAvatarChange,
  className = "",
}: PlayerProfileEditorProps) {
  const usernameInputId = useId();
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);

  return (
    <div className={`flex flex-col gap-4 ${className}`} data-testid="player-profile-editor">
      <label htmlFor={usernameInputId} className="flex flex-col gap-1 text-xs text-foreground">
        <span className="font-medium">Your name</span>
        <input
          id={usernameInputId}
          type="text"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          maxLength={MAX_USERNAME_LENGTH}
          placeholder={DEFAULT_USERNAME}
          className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </label>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <PlayerAvatarPreview avatar={avatar} seedColor={seedColor} />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-xs font-medium text-foreground">Avatar</span>
          <button
            type="button"
            onClick={() => setAvatarEditorOpen(true)}
            className="min-h-11 w-full rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-opacity hover:opacity-90 sm:w-auto"
          >
            Edit avatar
          </button>
        </div>
      </div>

      <PixelAvatarEditor
        open={avatarEditorOpen}
        onOpenChange={setAvatarEditorOpen}
        value={avatar}
        seedColor={seedColor}
        onSave={onAvatarChange}
      />
    </div>
  );
}
