import { DoorOpen, Dumbbell, LayoutTemplate, List, MessagesSquare, type LucideIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { cn } from '../shared/utils';
import { bookPath, chapterPath, useYallaResource, type BookSummary } from './yalla-api';

type SectionLink = { to: string; label: string; icon: LucideIcon; end?: boolean };

/** The chapter sections, as in language-learning-app's ChapterPage. */
export const CHAPTER_SECTIONS = [
  { path: 'dialog', label: 'Dialog', icon: MessagesSquare },
  { path: 'vocabulary', label: 'Vocabulary', icon: List },
  { path: 'patterns', label: 'Pattern', icon: LayoutTemplate },
  { path: 'exercises', label: 'Exercises', icon: Dumbbell },
] as const;

const HOME: SectionLink = { to: '/yalla', label: 'Home', icon: DoorOpen, end: true };

function sideLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
    'hover:bg-accent hover:text-accent-foreground',
    isActive && 'bg-accent text-accent-foreground',
  );
}

/**
 * YALLA's own navigation (docs/yalla/implementation-plan.md §2): a left
 * sidebar on large screens and, inside a chapter, an icon tab bar along the
 * bottom on small ones (reachable with a thumb, clear of the keyboard).
 */
export function YallaLayout() {
  const { book, chapter } = useParams();
  const bookResource = useYallaResource<BookSummary>(book ? `/books/${encodeURIComponent(book)}` : null);
  const inChapter = Boolean(book && chapter);

  const sectionLinks: SectionLink[] =
    book && chapter
      ? CHAPTER_SECTIONS.map((section) => ({
          to: `${chapterPath(book, chapter)}/${section.path}`,
          label: section.label,
          icon: section.icon,
        }))
      : [];

  return (
    <div className="flex min-h-full gap-4">
      <aside className="hidden w-52 shrink-0 lg:block" aria-label="YALLA">
        <nav className="sticky top-0 flex flex-col gap-1 py-2">
          <NavLink to={HOME.to} end className={sideLinkClass}>
            <HOME.icon className="h-4 w-4" aria-hidden />
            {HOME.label}
          </NavLink>

          {inChapter &&
            sectionLinks.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={sideLinkClass}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </NavLink>
            ))}

          {book && bookResource.data && (
            <div className="mt-4 flex flex-col gap-1 border-t pt-4">
              <Link
                to={bookPath(book)}
                className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:underline"
              >
                Chapters
              </Link>
              {bookResource.data.chapters.map((item) => (
                <NavLink key={item.chapter} to={chapterPath(book, item.chapter)} className={sideLinkClass}>
                  Chapter {item.chapter}
                </NavLink>
              ))}
            </div>
          )}
        </nav>
      </aside>

      <main className={cn('min-w-0 flex-1 py-2', inChapter && 'pb-20 lg:pb-2')}>
        <Outlet />
      </main>

      {inChapter && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label="Chapter sections"
        >
          {[HOME, ...sectionLinks].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[0.65rem] text-muted-foreground',
                  isActive && 'text-foreground',
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
