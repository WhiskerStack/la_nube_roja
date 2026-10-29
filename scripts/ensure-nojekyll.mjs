#!/usr/bin/env node
/**
 * scripts/ensure-nojekyll.mjs
 *
 * Creates an empty .nojekyll file inside public/ so Astro copies it
 * to dist/ during the build. This prevents GitHub Pages from ignoring
 * folders that start with an underscore, such as _astro/.
 *
 * Usage:
 *   node scripts/ensure-nojekyll.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const NOJEKYLL_PATH = path.join(PUBLIC_DIR, '.nojekyll');

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  try {
    await fs.access(NOJEKYLL_PATH);
    console.log('  ✓ public/.nojekyll ya existe');
  } catch {
    await fs.writeFile(NOJEKYLL_PATH, '', 'utf8');
    console.log('  ✓ public/.nojekyll creado');
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});