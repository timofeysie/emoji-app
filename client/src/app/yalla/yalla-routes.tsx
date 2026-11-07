import { Navigate, Route } from 'react-router-dom';
import { RequireYalla } from './RequireYalla';
import { YallaBooksView } from './YallaBooksView';
import { YallaBookView } from './YallaBookView';
import { YallaChapterView } from './YallaChapterView';
import { YallaLayout } from './YallaLayout';
import { DialogSection } from './sections/DialogSection';
import { ExercisesSection } from './sections/ExercisesSection';
import { PatternsSection } from './sections/PatternsSection';
import { VocabularySection } from './sections/VocabularySection';

/** YALLA's routes, all behind `RequireYalla` (docs/yalla/implementation-plan.md §1). */
export const yallaRoutes = (
  <Route
    path="/yalla"
    element={
      <RequireYalla>
        <YallaLayout />
      </RequireYalla>
    }
  >
    <Route index element={<YallaBooksView />} />
    <Route path="books/:book" element={<YallaBookView />} />
    <Route path="books/:book/chapters/:chapter" element={<YallaChapterView />}>
      <Route index element={<Navigate to="dialog" replace />} />
      <Route path="dialog" element={<DialogSection />} />
      <Route path="vocabulary" element={<VocabularySection />} />
      <Route path="patterns" element={<PatternsSection />} />
      <Route path="exercises" element={<ExercisesSection />} />
    </Route>
  </Route>
);
