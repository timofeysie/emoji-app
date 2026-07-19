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

/** Minimum Zero controller script version considered current. */
export const EXPECTED_CONTROLLER_VERSION =
  process.env['EXPECTED_CONTROLLER_VERSION'] ?? '0.7.5'

/** Minimum Pico badge script version considered current. */
export const EXPECTED_PICO_VERSION =
  process.env['EXPECTED_PICO_VERSION'] ?? '0.5.2';
