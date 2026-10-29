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

const MAX_PAGE_HEIGHT = 20_000;
const PAGE_HARD_TIMEOUT = 90_000;

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
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      reducedMotion: 'reduce',
    },
  },
];

function log(message) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${message}`);
}

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

async function preparePage(page, label) {
  log(`${label} - desactivando animaciones y smooth scroll`);
  await page.addStyleTag({
    content: `
      html, body { scroll-behavior: auto !important; }
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });

  log(`${label} - esperando red`);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  log(`${label} - esperando fuentes`);
  await page.evaluate(() =>
    Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  );

  log(`${label} - scroll para lazy load`);
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight * 0.75, 300);
    let y = 0;
    let guard = 0;

    while (y < document.documentElement.scrollHeight && guard < 200) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
      y += step;
      guard += 1;
    }

    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  log(`${label} - esperando imágenes`);
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      })
    );
  });
}

async function captureRoute(browser, device, route) {
  const url = `${BASE_URL}${route}`;
  const name = `${routeToName(route)}-${device.name}.png`;
  const output = path.join(OUTPUT_DIR, name);
  const label = `[${device.name}] ${route}`;

  log(`${label} - creando contexto`);
  const context = await browser.newContext(device.context);

  const run = async () => {
    const page = await context.newPage();

    try {
      log(`${label} - goto`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      await preparePage(page, label);

      const dims = await page.evaluate(() => ({
        width: Math.ceil(document.documentElement.scrollWidth),
        height: Math.ceil(document.documentElement.scrollHeight),
      }));
      log(`${label} - dimensiones: ${dims.width}x${dims.height}`);

      const targetHeight = Math.min(dims.height, MAX_PAGE_HEIGHT);
      if (targetHeight < dims.height) {
        log(`${label} - recortando altura a ${targetHeight}px (era ${dims.height}px)`);
      }

      log(`${label} - redimensionando viewport a ${device.context.viewport.width}x${targetHeight}`);
      await page.setViewportSize({
        width: device.context.viewport.width,
        height: targetHeight,
      });

      await page.waitForTimeout(600);

      log(`${label} - capturando screenshot`);
      await page.screenshot({
        path: output,
        timeout: 30_000,
        animations: 'disabled',
        caret: 'hide',
        fullPage: false,
      });

      log(`${label} - OK -> local/screenshot/${name}`);
    } finally {
      await page.close().catch(() => {});
    }
  };

  // Timer de hard timeout, cancelable.
  let timerHandle;
  const hardTimeout = new Promise((_, reject) => {
    timerHandle = setTimeout(
      () => reject(new Error(`HARD TIMEOUT tras ${PAGE_HARD_TIMEOUT}ms`)),
      PAGE_HARD_TIMEOUT
    );
    // Respaldo: no mantiene vivo el event loop si se nos olvida clearTimeout.
    timerHandle.unref?.();
  });

  try {
    await Promise.race([run(), hardTimeout]);
  } catch (error) {
    console.error(`  ✗ ${label}: ${error.message}`);
  } finally {
    clearTimeout(timerHandle);
    await context.close().catch(() => {});
  }
}

async function main() {
  await assertServerIsUp();

  const astroFiles = (await walk(PAGES_DIR)).filter((file) => file.endsWith('.astro'));
  const routes = [...new Set(astroFiles.map(toRoute).filter(Boolean))].sort();

  if (routes.length === 0) {
    throw new Error(`No se encontraron páginas estáticas en ${PAGES_DIR}`);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  log(`Páginas detectadas: ${routes.join(', ')}`);

  const browser = await chromium.launch({
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  try {
    for (const device of DEVICES) {
      log(`=== Dispositivo: ${device.name} ===`);
      for (const route of routes) {
        await captureRoute(browser, device, route);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log(`Listo. Capturas guardadas en ${OUTPUT_DIR}`);
}

main()
  .then(() => {
    // Fuerza la salida: si alguna lib de Playwright deja un handle colgado,
    // no queremos que el proceso quede zombie.
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  });