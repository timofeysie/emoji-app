import { resetEvidenceCache } from '../learning/student-evidence';

beforeEach(() => {
  delete process.env['MONGODB_URI'];
  resetEvidenceCache();
});
