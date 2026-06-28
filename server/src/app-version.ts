import { readFileSync } from 'fs';
import path from 'path';

function readVersion(): string {
  const candidates = [
    path.join(__dirname, 'package.json'),
    path.join(__dirname, '../../package.json'),
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string };
      if (typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }

  return 'unknown';
}

export const APP_VERSION = readVersion();
