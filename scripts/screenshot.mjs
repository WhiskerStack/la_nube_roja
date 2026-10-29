#!/usr/bin/env node
/**
 * scripts/screenshot.mjs
 *
 * Captures full-page screenshots (desktop + mobile) for every static page
 * found in src/pages, and stores them in local/screenshot.
 *
 * Requirements:
 *   pnpm add -D playwright
 *   pnpm exec playwright install chromium
 *
 * Usage:
 *   pnpm dev            # in another terminal
 *   node scripts/screenshot.mjs
 *
 * Optional:
 *   BASE_URL=http://localhost:4321 node scripts/screenshot.mjs
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'src', 'pages');
const OUTPUT_DIR = path.join(ROOT, 'local', 'screenshot');
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:4321').replace(/\/+$/, '');

const DEVICES = [
  {
    name: 'desktop',
    context: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      reducedMotion: 'reduce',
    },
  },
  {
    name: 'mobile',
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  },
];

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

function toRoute(file) {
  let relative = path.relative(PAGES_DIR, file).split(path.sep).join('/');

  if (!relative.endsWith('.astro')) return null;
  relative = relative.slice(0, -'.astro'.length);

  // Skip private files, dynamic routes and 404
  if (relative.split('/').some((segment) => segment.startsWith('_'))) return null;
  if (relative.includes('[')) return null;
  if (relative === '404') return null;

  if (relative === 'index') return '/';
  if (relative.endsWith('/index')) return '/' + relative.slice(0, -'/index'.length);

  return '/' + relative;
}

function routeToName(route) {
  if (route === '/') return 'home';
  return route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
}

async function assertServerIsUp() {
  try {
    const response = await fetch(BASE_URL, { method: 'GET' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `No se pudo conectar con ${BASE_URL}. Inicia el servidor con "pnpm dev" o define BASE_URL.\n` +
        `Detalle: ${error.message}`
    );
  }
}

async function triggerLazyContent(page) {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight * 0.75, 300);
    let y = 0;
    let guard = 0;

    while (y < document.body.scrollHeight && guard < 200) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
      y += step;
      guard += 1;
    }

    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

async function waitForImages(page) {
  await page.evaluate(async () => {
    const images = Array.from(document.images);

    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }

            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 5000);
          })
      )
    );

    await Promise.all(
      images.map((img) =>
        typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve()
      )
    );
  });
}

async function preparePage(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await triggerLazyContent(page);
  await waitForImages(page);
  await page.waitForTimeout(250);
}

async function main() {
  await assertServerIsUp();

  const astroFiles = (await walk(PAGES_DIR)).filter((file) => file.endsWith('.astro'));
  const routes = [...new Set(astroFiles.map(toRoute).filter(Boolean))].sort();

  if (routes.length === 0) {
    throw new Error(`No se encontraron páginas estáticas en ${PAGES_DIR}`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Páginas detectadas: ${routes.join(', ')}`);

  const browser = await chromium.launch();

  try {
    for (const device of DEVICES) {
      const context = await browser.newContext(device.context);

      for (const route of routes) {
        const url = `${BASE_URL}${route}`;
        const name = `${routeToName(route)}-${device.name}.png`;
        const output = path.join(OUTPUT_DIR, name);
        const page = await context.newPage();

        console.log(`Capturando ${url} (${device.name}) -> local/screenshot/${name}`);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await preparePage(page);

        await page.screenshot({
          path: output,
          fullPage: true,
          animations: 'disabled',
        });

        await page.close();
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\nListo. Capturas guardadas en ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});