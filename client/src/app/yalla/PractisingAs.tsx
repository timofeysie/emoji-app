import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMeStore } from './me.store';

/** One line saying whose progress YALLA records, with a link to change it. */
export function PractisingAs() {
  const { me, error, load } = useMeStore();

  useEffect(() => {
    void load();
  }, [load]);

  if (error || !me) return null;

  return (
    <p className="text-sm text-muted-foreground" data-testid="practising-as">
      {me.player ? (
        <>
          Practising as <strong className="text-foreground">{me.player.firstName}</strong> ·{' '}
          <Link to="/profile" className="underline">
            change
          </Link>
        </>
      ) : (
        <>
          <Link to="/profile" className="underline">
            Link your profile to a player
          </Link>{' '}
          to track your progress.
        </>
      )}
    </p>
  );
}
