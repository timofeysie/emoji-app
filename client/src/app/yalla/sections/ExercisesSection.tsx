import { Dumbbell } from 'lucide-react';

/** Placeholder until Leitner practice lands (milestones Y4 and Y5). */
export function ExercisesSection() {
  return (
    <section
      aria-label="Exercises"
      className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      <Dumbbell className="mx-auto mb-2 h-8 w-8 opacity-40" aria-hidden />
      Practice is coming soon: Leitner sessions with multiple choice or typed answers.
    </section>
  );
}
