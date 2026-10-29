#!/usr/bin/env node
/**
 * scripts/export.mjs
 *
 * Empaqueta el proyecto en un ZIP usando una WHITELIST.
 *
 * Uso:
 *   pnpm export
 *
 * Salida:
 *   local/exports/<project-name>-<timestamp>.zip
 */

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from '@archiver/archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'local', 'exports');

// WHITELIST: solo estas rutas entran al ZIP.
const INCLUDE_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'astro.config.mjs',
  'tsconfig.json',
  '.gitignore',
  'README.md',
  'AGENTS.md',
  'DEEPSEEK.md',
  'DESIGN.md',
  'src',
  'scripts',
  'public',
];

const EXCLUDED_NAMES = new Set([
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.git',
]);

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(absPath, relPath) {
  const out = [];
  const stat = await fs.stat(absPath);

  if (stat.isFile()) {
    out.push({ abs: absPath, rel: relPath });
    return out;
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;

      const childAbs = path.join(absPath, entry.name);
      const childRel = path.posix.join(relPath, entry.name);
      out.push(...(await collectFiles(childAbs, childRel)));
    }
  }

  return out;
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const projectName = pkg.name || 'project';

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const fileName = `${projectName}-${timestamp()}.zip`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  // 1) Resolver la whitelist
  const included = [];
  const missing = [];

  for (const rel of INCLUDE_PATHS) {
    const abs = path.join(ROOT, rel);
    if (!(await pathExists(abs))) {
      missing.push(rel);
      continue;
    }
    included.push({ abs, rel });
  }

  if (included.length === 0) {
    throw new Error('La whitelist no coincide con ningún archivo del proyecto.');
  }

  // 2) Crear el archivo ZIP con la clase ZipArchive
  const output = createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') console.warn(`  ! ${err.message}`);
    else throw err;
  });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);

  // 3) Añadir archivos
  console.log('Archivos incluidos en el ZIP:');
  let fileCount = 0;

  for (const { abs, rel } of included) {
    const files = await collectFiles(abs, rel);
    for (const f of files) {
      archive.file(f.abs, { name: f.rel });
      fileCount += 1;
    }
    const stat = await fs.stat(abs);
    const suffix = stat.isDirectory() ? '/' : '';
    const plural = files.length === 1 ? '' : 's';
    console.log(`  ✓ ${rel}${suffix}  (${files.length} archivo${plural})`);
  }

  if (missing.length > 0) {
    console.log('\nRutas de la whitelist que no existen (se omiten):');
    for (const rel of missing) console.log(`  - ${rel}`);
  }

  // 4) Finalizar
  await archive.finalize();
  await done;

  const size = (await fs.stat(outputPath)).size;
  const sizeKb = (size / 1024).toFixed(1);

  console.log(
    `\n✓ ZIP generado: local/exports/${fileName} (${sizeKb} KB, ${fileCount} archivos)`
  );
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});