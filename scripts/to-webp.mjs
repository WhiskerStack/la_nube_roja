#!/usr/bin/env node
/**
 * scripts/to-webp.mjs
 *
 * Converts every raster image under public/ to WebP, rewrites references in src/
 * to point to the new .webp files, and finally deletes the originals.
 *
 * Requirements:
 *   pnpm add -D sharp
 *
 * Usage:
 *   node scripts/to-webp.mjs
 */

import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SRC_DIR = path.join(ROOT, 'src');

const SOURCE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

const TEXT_EXTENSIONS = new Set([
  '.astro',
  '.ts',
  '.js',
  '.mjs',
  '.mts',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.css',
  '.html',
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await pathExists(PUBLIC_DIR))) {
    throw new Error(`No existe la carpeta ${PUBLIC_DIR}`);
  }

  const allFiles = await walk(PUBLIC_DIR);
  const imageFiles = allFiles.filter((file) =>
    SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())
  );

  if (imageFiles.length === 0) {
    console.log('No se encontraron imágenes para convertir.');
    return;
  }

  /**
   * filename.ext -> filename.webp
   * @type {Map<string, string>}
   */
  const replacements = new Map();

  /**
   * outputPath -> originalPath
   * @type {Map<string, string>}
   */
  const outputs = new Map();

  const converted = [];
  const skipped = [];

  console.log('Convirtiendo imágenes a WebP...');

  for (const input of imageFiles) {
    const extension = path.extname(input).toLowerCase();
    const output = input.slice(0, -extension.length) + '.webp';

    if (outputs.has(output)) {
      console.warn(
        `  ! Colisión: "${path.relative(ROOT, input)}" y ` +
          `"${path.relative(ROOT, outputs.get(output))}" generarían el mismo .webp. ` +
          `Se omite el primero.`
      );
      skipped.push(input);
      continue;
    }

    if (await pathExists(output)) {
      console.warn(
        `  ! Ya existe "${path.relative(ROOT, output)}". Se sobrescribirá.`
      );
    }

    try {
      const image = sharp(input, { animated: extension === '.gif' });
      const metadata = await image.metadata();

      await image
        .webp({
          quality: 82,
          effort: 4,
          ...(metadata.pages && metadata.pages > 1 ? { loop: 0 } : {}),
        })
        .toFile(output);

      outputs.set(output, input);
      replacements.set(path.basename(input), path.basename(output));
      converted.push({ input, output });

      console.log(`  ✓ ${path.relative(ROOT, input)} -> ${path.relative(ROOT, output)}`);
    } catch (error) {
      console.error(
        `  ✗ No se pudo convertir "${path.relative(ROOT, input)}": ${error.message}`
      );
      skipped.push(input);
    }
  }

  if (converted.length === 0) {
    console.log('No se convirtió ninguna imagen. No se modificó src/.');
    return;
  }

  console.log('\nActualizando referencias en src/...');

  const srcFiles = await walk(SRC_DIR);
  const textFiles = srcFiles.filter((file) =>
    TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
  );

  let touchedFiles = 0;
  let replacementCount = 0;

  for (const file of textFiles) {
    const content = await fs.readFile(file, 'utf8');
    let next = content;

    for (const [oldName, newName] of replacements) {
      if (!next.includes(oldName)) continue;

      const occurrences = next.split(oldName).length - 1;
      next = next.split(oldName).join(newName);
      replacementCount += occurrences;
    }

    if (next !== content) {
      await fs.writeFile(file, next, 'utf8');
      touchedFiles += 1;
      console.log(`  ↻ ${path.relative(ROOT, file)}`);
    }
  }

  console.log('\nEliminando imágenes originales...');

  let deleted = 0;

  for (const { input, output } of converted) {
    if (!(await pathExists(output))) {
      console.warn(
        `  ! No se borra "${path.relative(ROOT, input)}": ` +
          `no existe "${path.relative(ROOT, output)}".`
      );
      continue;
    }

    await fs.unlink(input);
    deleted += 1;
  }

  console.log('\nResumen:');
  console.log(`  Imágenes convertidas: ${converted.length}`);
  console.log(`  Archivos de src/ actualizados: ${touchedFiles}`);
  console.log(`  Referencias reemplazadas: ${replacementCount}`);
  console.log(`  Imágenes originales eliminadas: ${deleted}`);

  if (skipped.length > 0) {
    console.log(`  Imágenes omitidas: ${skipped.length}`);
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});