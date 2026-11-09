import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST_ROOTS,
  BASE_URL,
  CATEGORY_ALIASES,
  MIN_DELAY_MS,
  USER_AGENT,
  runHarvest,
} from './harvest';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

const LISTING_HTML = readFixture('listing-processor.html');
const PRODUCT_HTML = readFixture('product-aoc-25g4k.html');

const ROBOTS_TXT = [
  'User-agent: *',
  'Disallow: ?product_id=',
  'Disallow: /product/search?*',
  '',
].join('\n');

const LAST_PAGE_HTML =
  '<!DOCTYPE html><html><body><div class="main-content"></div></body></html>';

const SPEC_ROOTS = [
  '/component/processor',
  '/component/motherboard',
  '/component/ram',
  '/component/laptop-ram',
  '/component/graphics-card',
  '/component/power-supply',
  '/laptop-notebook/laptop',
  '/gaming-laptop',
  '/laptop-notebook/ultrabook',
  '/laptop-notebook/laptop-accessories',
  '/desktops',
  '/monitor',
  '/networking',
];

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function header(init: RequestInit | undefined, name: string): string | null {
  if (!init?.headers) return null;
  const headers = new Headers(init.headers);
  return headers.get(name);
}

function listingWithLinks(hrefs: string[]): string {
  const items = hrefs
    .map(
      (href) => `
      <div class="p-item">
        <div class="p-item-inner">
          <h4 class="p-item-name"><a href="${href}">Item ${href}</a></h4>
        </div>
      </div>`,
    )
    .join('');
  return `<!DOCTYPE html><html><body><div class="main-content">${items}</div></body></html>`;
}

function textResponse(body: string, status = 200, type = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

function htmlResponse(body: string, status = 200): Response {
  return textResponse(body, status, 'text/html');
}

type RecordedCall = { url: string; userAgent: string | null };

function withRawDir<T>(fn: (rawDir: string) => Promise<T>): Promise<T> {
  const rawDir = mkdtempSync(join(tmpdir(), 'catalog-harvest-'));
  return fn(rawDir).finally(() => {
    rmSync(rawDir, { recursive: true, force: true });
  });
}

function mockFetch(pages: (url: URL) => Response | undefined): {
  calls: RecordedCall[];
  fetchFn: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = hrefOf(input);
    calls.push({ url, userAgent: header(init, 'User-Agent') });
    const parsed = new URL(url);
    const page = pages(parsed);
    if (!page) throw new Error(`unexpected fetch: ${url}`);
    return page;
  };
  return { calls, fetchFn };
}

function defaultPages(url: URL): Response | undefined {
  if (url.pathname === '/robots.txt') return textResponse(ROBOTS_TXT);
  if (url.pathname === '/component/processor' && !url.searchParams.get('page')) {
    return htmlResponse(LISTING_HTML);
  }
  if (url.pathname === '/component/processor' && url.searchParams.get('page') === '2') {
    return htmlResponse(LAST_PAGE_HTML);
  }
  if (url.pathname === '/amd-ryzen-5-5600' || url.pathname === '/aoc-25g4k') {
    return htmlResponse(PRODUCT_HTML);
  }
  return undefined;
}

describe('harvest constants', () => {
  it('pins User-Agent, delay, base URL, and spec allowlist roots', () => {
    assert.equal(USER_AGENT, 'ERP71CatalogHarvest/1.0 (+https://erp71.com)');
    assert.equal(MIN_DELAY_MS, 1000);
    assert.equal(BASE_URL, 'https://www.startech.com.bd');
    assert.equal(CATEGORY_ALIASES.processor, '/component/processor');
    for (const root of SPEC_ROOTS) {
      assert.ok(ALLOWLIST_ROOTS.includes(root), root);
      assert.ok(Object.values(CATEGORY_ALIASES).includes(root), root);
    }
  });
});

describe('runHarvest', () => {
  it('walks a listing then product pages using fixture HTML', async () => {
    await withRawDir(async (rawDir) => {
      const { calls, fetchFn } = mockFetch(defaultPages);
      const sleeps: number[] = [];

      const result = await runHarvest({
        category: 'processor',
        fetchFn,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
        rawDir,
      });

      assert.equal(result.stoppedReason, 'done');
      assert.equal(result.fetched, 2);

      const paths = calls.map((c) => new URL(c.url).pathname);
      assert.equal(paths[0], '/robots.txt');
      assert.ok(paths.includes('/component/processor'));
      assert.ok(paths.includes('/amd-ryzen-5-5600'));
      assert.ok(paths.includes('/aoc-25g4k'));
      assert.ok(paths.indexOf('/component/processor') < paths.indexOf('/aoc-25g4k'));

      const jsonl = readFileSync(join(rawDir, 'processor.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { title: string; brand: string; url: string });
      assert.equal(jsonl.length, 2);
      assert.ok(jsonl.some((row) => row.url.includes('/aoc-25g4k')));
      assert.ok(jsonl.some((row) => row.title === 'AOC 25G4K Gaming Monitor' && row.brand === 'AOC'));
      assert.equal(sleeps.length, calls.length - 1);
    });
  });

  it('sends USER_AGENT on every request', async () => {
    await withRawDir(async (rawDir) => {
      const { calls, fetchFn } = mockFetch(defaultPages);
      await runHarvest({
        category: 'processor',
        fetchFn,
        sleepFn: async () => {},
        rawDir,
      });
      assert.ok(calls.length > 0);
      for (const call of calls) {
        assert.equal(call.userAgent, USER_AGENT);
      }
    });
  });

  it('sleeps MIN_DELAY_MS before every request except robots.txt', async () => {
    await withRawDir(async (rawDir) => {
      const events: string[] = [];
      const { fetchFn } = mockFetch((url) => {
        events.push(`fetch ${url.pathname}${url.search}`);
        return defaultPages(url);
      });

      await runHarvest({
        category: 'processor',
        fetchFn,
        sleepFn: async (ms) => {
          events.push(`sleep ${ms}`);
        },
        rawDir,
      });

      assert.ok(events[0]?.startsWith('fetch /robots.txt'));
      assert.ok(events.includes('sleep 1000'));
      for (let i = 0; i < events.length; i++) {
        if (events[i] === 'sleep 1000') {
          assert.ok(events[i + 1]?.startsWith('fetch '));
        }
      }
      const fetches = events.filter((e) => e.startsWith('fetch '));
      const sleeps = events.filter((e) => e.startsWith('sleep '));
      assert.equal(sleeps.length, fetches.length - 1);
      assert.ok(sleeps.every((s) => s === `sleep ${MIN_DELAY_MS}`));
    });
  });

  it('does not fetch a robots-disallowed URL', async () => {
    await withRawDir(async (rawDir) => {
      const listing = listingWithLinks([
        '/aoc-25g4k',
        '/product/search?q=ryzen',
        '/amd-ryzen-5-5600?product_id=99',
      ]);
      const { calls, fetchFn } = mockFetch((url) => {
        if (url.pathname === '/robots.txt') return textResponse(ROBOTS_TXT);
        if (url.pathname === '/component/processor') return htmlResponse(listing);
        if (url.pathname === '/aoc-25g4k') return htmlResponse(PRODUCT_HTML);
        return undefined;
      });

      const result = await runHarvest({
        category: 'processor',
        fetchFn,
        sleepFn: async () => {},
        rawDir,
      });

      assert.equal(result.stoppedReason, 'done');
      assert.equal(result.fetched, 1);
      const fetched = calls.map((c) => c.url);
      assert.equal(
        fetched.some((u) => u.includes('/product/search')),
        false,
      );
      assert.equal(
        fetched.some((u) => u.includes('product_id=')),
        false,
      );
      assert.ok(fetched.some((u) => new URL(u).pathname === '/aoc-25g4k'));
    });
  });

  it('writes checkpoint.json and returns stoppedReason 429', async () => {
    await withRawDir(async (rawDir) => {
      const { fetchFn } = mockFetch((url) => {
        if (url.pathname === '/robots.txt') return textResponse(ROBOTS_TXT);
        if (url.pathname === '/component/processor') return htmlResponse(LISTING_HTML);
        if (url.pathname === '/amd-ryzen-5-5600') return htmlResponse(PRODUCT_HTML);
        if (url.pathname === '/aoc-25g4k') return htmlResponse('rate limited', 429);
        return undefined;
      });

      const result = await runHarvest({
        category: 'processor',
        fetchFn,
        sleepFn: async () => {},
        rawDir,
      });

      assert.equal(result.stoppedReason, '429');
      assert.equal(result.fetched, 1);
      const checkpointPath = join(rawDir, 'checkpoint.json');
      assert.equal(existsSync(checkpointPath), true);
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
        completedRoots: string[];
        currentRoot: string;
        currentPage: number;
        fetchedProductUrls: string[];
      };
      assert.ok(Array.isArray(checkpoint.completedRoots));
      assert.equal(typeof checkpoint.currentRoot, 'string');
      assert.equal(typeof checkpoint.currentPage, 'number');
      assert.ok(
        checkpoint.fetchedProductUrls.some((u) => u.includes('/amd-ryzen-5-5600')),
      );
    });
  });

  it('second run with a checkpoint does not re-fetch completed product URLs', async () => {
    await withRawDir(async (rawDir) => {
      const first = mockFetch((url) => {
        if (url.pathname === '/robots.txt') return textResponse(ROBOTS_TXT);
        if (url.pathname === '/component/processor') return htmlResponse(LISTING_HTML);
        if (url.pathname === '/amd-ryzen-5-5600') return htmlResponse(PRODUCT_HTML);
        if (url.pathname === '/aoc-25g4k') return htmlResponse('rate limited', 429);
        return undefined;
      });

      const stopped = await runHarvest({
        category: 'processor',
        fetchFn: first.fetchFn,
        sleepFn: async () => {},
        rawDir,
      });
      assert.equal(stopped.stoppedReason, '429');

      const second = mockFetch(defaultPages);
      const resumed = await runHarvest({
        category: 'processor',
        fetchFn: second.fetchFn,
        sleepFn: async () => {},
        rawDir,
      });

      assert.equal(resumed.stoppedReason, 'done');
      const secondProducts = second.calls.filter((c) => {
        const path = new URL(c.url).pathname;
        return path === '/amd-ryzen-5-5600' || path === '/aoc-25g4k';
      });
      assert.equal(
        secondProducts.some((c) => new URL(c.url).pathname === '/amd-ryzen-5-5600'),
        false,
      );
      assert.ok(secondProducts.some((c) => new URL(c.url).pathname === '/aoc-25g4k'));
    });
  });

  it('does not fetch listing URLs outside ALLOWLIST_ROOTS when running --all', async () => {
    await withRawDir(async (rawDir) => {
      const { calls, fetchFn } = mockFetch((url) => {
        if (url.pathname === '/robots.txt') return textResponse(ROBOTS_TXT);
        if (ALLOWLIST_ROOTS.includes(url.pathname)) return htmlResponse(LAST_PAGE_HTML);
        return undefined;
      });

      const result = await runHarvest({
        category: 'all',
        fetchFn,
        sleepFn: async () => {},
        rawDir,
      });

      assert.equal(result.stoppedReason, 'done');
      const listingPaths = calls
        .map((c) => new URL(c.url).pathname)
        .filter((p) => p !== '/robots.txt');
      assert.ok(listingPaths.length >= 2);
      for (const path of listingPaths) {
        assert.ok(ALLOWLIST_ROOTS.includes(path), path);
      }
      assert.ok(listingPaths.includes('/component/processor'));
      assert.ok(listingPaths.includes('/component/motherboard'));
    });
  });
});
