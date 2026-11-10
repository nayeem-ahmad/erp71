import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseListingPage, parseProductPage } from './parse-product';
import type { HarvestProduct } from './types';

export const USER_AGENT = 'ERP71CatalogHarvest/1.0 (+https://erp71.com)';
export const MIN_DELAY_MS = 1000;
export const BASE_URL = 'https://www.startech.com.bd';

/** Star Tech category roots from the spec allowlist table. */
export const CATEGORY_ALIASES: Record<string, string> = {
  processor: '/component/processor',
  motherboard: '/component/motherboard',
  ram: '/component/ram',
  'laptop-ram': '/component/laptop-ram',
  'graphics-card': '/component/graphics-card',
  'power-supply': '/component/power-supply',
  'cpu-cooler': '/component/cpu-cooler',
  casing: '/component/casing',
  // Live listings; /component/ssd and /component/hdd 404.
  ssd: '/ssd',
  hdd: '/component/hard-disk-drive',
  laptop: '/laptop-notebook/laptop',
  'gaming-laptop': '/gaming-laptop',
  ultrabook: '/laptop-notebook/ultrabook',
  'laptop-accessories': '/laptop-notebook/laptop-accessories',
  desktops: '/desktops',
  monitor: '/monitor',
  networking: '/networking',
  // Discovered from Star Tech homepage nav; in-scope spec groups only.
  keyboard: '/accessories/keyboards',
  mouse: '/accessories/mouse',
  headset: '/accessories/headphone',
  speaker: '/accessories/speaker-and-home-theater',
  webcam: '/accessories/webcam',
  printer: '/printer',
  scanner: '/office-equipment/scanner',
  ups: '/ups',
  'hdmi-cable': '/hdmi-cable',
  'usb-cable': '/usb-cable',
  hub: '/hub-and-dock',
  'pen-drive': '/pen-drive',
  'memory-card': '/memory-card',
};

export const ALLOWLIST_ROOTS: string[] = [...new Set(Object.values(CATEGORY_ALIASES))];

export type HarvestOptions = {
  category: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  rawDir?: string;
  stdout?: { write(s: string): void };
};

export type HarvestResult = {
  fetched: number;
  stoppedReason: 'done' | '429' | '403';
};

type Checkpoint = {
  completedRoots: string[];
  currentRoot: string;
  currentPage: number;
  fetchedProductUrls: string[];
};

type Target = { alias: string; root: string };

const UA_HEADERS = { 'User-Agent': USER_AGENT } as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultRawDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'raw');
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function pageNumberFromUrl(url: string): number | null {
  const match = url.match(/[?&]page=(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listingUrl(root: string, page: number): string {
  const url = new URL(root, `${BASE_URL}/`);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.href;
}

function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed || '/';
}

function isAllowlistedListing(url: string, roots: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, BASE_URL);
  } catch {
    return false;
  }
  if (parsed.origin !== originOf(BASE_URL)) return false;
  const path = normalizePath(parsed.pathname);
  return roots.some((root) => normalizePath(root) === path);
}

function pathAndQuery(url: string): string {
  const parsed = new URL(url, BASE_URL);
  return parsed.pathname + parsed.search;
}

function matchesDisallow(pathQuery: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped).test(pathQuery);
}

function isDisallowed(url: string, disallows: string[]): boolean {
  const pq = pathAndQuery(url);
  return disallows.some((pattern) => matchesDisallow(pq, pattern));
}

function parseRobots(text: string): string[] {
  const disallows: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      applies = value === '*' || value.toLowerCase() === USER_AGENT.toLowerCase();
      continue;
    }
    if (field === 'disallow' && applies && value) disallows.push(value);
  }
  return disallows;
}

function resolveTargets(category: string): Target[] {
  if (category === 'all') {
    const seen = new Set<string>();
    const targets: Target[] = [];
    for (const [alias, root] of Object.entries(CATEGORY_ALIASES)) {
      if (!ALLOWLIST_ROOTS.includes(root) || seen.has(root)) continue;
      seen.add(root);
      targets.push({ alias, root });
    }
    return targets;
  }
  const root = CATEGORY_ALIASES[category];
  if (!root) throw new Error(`Unknown category alias: ${category}`);
  if (!ALLOWLIST_ROOTS.includes(root)) {
    throw new Error(`Category ${category} is not on the allowlist`);
  }
  return [{ alias: category, root }];
}

function emptyCheckpoint(): Checkpoint {
  return {
    completedRoots: [],
    currentRoot: '',
    currentPage: 1,
    fetchedProductUrls: [],
  };
}

function loadCheckpoint(rawDir: string): Checkpoint {
  const path = join(rawDir, 'checkpoint.json');
  if (!existsSync(path)) return emptyCheckpoint();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Checkpoint>;
    return {
      completedRoots: Array.isArray(parsed.completedRoots)
        ? parsed.completedRoots.filter((r): r is string => typeof r === 'string')
        : [],
      currentRoot: typeof parsed.currentRoot === 'string' ? parsed.currentRoot : '',
      currentPage: typeof parsed.currentPage === 'number' && parsed.currentPage > 0 ? parsed.currentPage : 1,
      fetchedProductUrls: Array.isArray(parsed.fetchedProductUrls)
        ? parsed.fetchedProductUrls.filter((u): u is string => typeof u === 'string')
        : [],
    };
  } catch {
    return emptyCheckpoint();
  }
}

function writeCheckpoint(rawDir: string, checkpoint: Checkpoint): void {
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
}

function appendProduct(rawDir: string, alias: string, product: HarvestProduct): void {
  mkdirSync(rawDir, { recursive: true });
  appendFileSync(join(rawDir, `${alias}.jsonl`), `${JSON.stringify(product)}\n`);
}

function stoppedStatus(status: number): '429' | '403' | null {
  if (status === 429) return '429';
  if (status === 403) return '403';
  return null;
}

function isHarvestStop(res: Response | HarvestResult): res is HarvestResult {
  return 'stoppedReason' in res;
}

export async function runHarvest(opts: HarvestOptions): Promise<HarvestResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleepFn = opts.sleepFn ?? defaultSleep;
  const rawDir = opts.rawDir ?? defaultRawDir();
  const log = opts.stdout;
  const targets = resolveTargets(opts.category);

  mkdirSync(rawDir, { recursive: true });

  const saved = loadCheckpoint(rawDir);
  const completedRoots = new Set(saved.completedRoots);
  const fetchedProductUrls = new Set(saved.fetchedProductUrls);
  let fetched = 0;

  const snapshot = (currentRoot: string, currentPage: number): Checkpoint => ({
    completedRoots: [...completedRoots],
    currentRoot,
    currentPage,
    fetchedProductUrls: [...fetchedProductUrls],
  });

  const request = async (url: string, skipSleep: boolean): Promise<Response | HarvestResult> => {
    if (!skipSleep) await sleepFn(MIN_DELAY_MS);
    const res = await fetchFn(url, { headers: UA_HEADERS });
    const stopped = stoppedStatus(res.status);
    if (stopped) return { fetched, stoppedReason: stopped };
    return res;
  };

  const robotsUrl = `${BASE_URL}/robots.txt`;
  const robotsRes = await request(robotsUrl, true);
  if (isHarvestStop(robotsRes)) {
    writeCheckpoint(rawDir, snapshot('', 1));
    return robotsRes;
  }
  const disallows = parseRobots(await robotsRes.text());

  for (const { alias, root } of targets) {
    if (completedRoots.has(root)) continue;

    const startPage = saved.currentRoot === root ? saved.currentPage : 1;
    let listUrl: string | null = listingUrl(root, startPage);

    while (listUrl) {
      if (!isAllowlistedListing(listUrl, [root]) || isDisallowed(listUrl, disallows)) {
        completedRoots.add(root);
        writeCheckpoint(rawDir, snapshot('', 1));
        break;
      }

      const page = pageNumberFromUrl(listUrl) ?? 1;
      const listRes = await request(listUrl, false);
      if (isHarvestStop(listRes)) {
        writeCheckpoint(rawDir, snapshot(root, page));
        return listRes;
      }

      const listing = parseListingPage(await listRes.text(), listUrl);
      for (const productUrl of listing.productUrls) {
        let productParsed: URL;
        try {
          productParsed = new URL(productUrl, BASE_URL);
        } catch {
          continue;
        }
        const productHref = productParsed.href;
        if (fetchedProductUrls.has(productHref) || fetchedProductUrls.has(productUrl)) continue;
        if (isDisallowed(productHref, disallows) || isDisallowed(productUrl, disallows)) continue;
        if (productParsed.origin !== originOf(BASE_URL)) continue;

        const productRes = await request(productHref, false);
        if (isHarvestStop(productRes)) {
          writeCheckpoint(rawDir, snapshot(root, page));
          return productRes;
        }
        if (!productRes.ok) continue;

        const product = parseProductPage(await productRes.text(), productHref);
        appendProduct(rawDir, alias, product);
        fetchedProductUrls.add(productHref);
        fetched += 1;
        log?.write(`fetched ${productHref}\n`);
      }

      const next = listing.nextPage;
      if (
        next &&
        isAllowlistedListing(next, [root]) &&
        !isDisallowed(next, disallows)
      ) {
        writeCheckpoint(rawDir, snapshot(root, pageNumberFromUrl(next) ?? page + 1));
        listUrl = next;
      } else {
        completedRoots.add(root);
        writeCheckpoint(rawDir, snapshot('', page));
        listUrl = null;
      }
    }
  }

  writeCheckpoint(rawDir, snapshot('', 1));
  return { fetched, stoppedReason: 'done' };
}

function parseArgv(argv: string[]): HarvestOptions {
  if (argv.includes('--all')) return { category: 'all' };
  const idx = argv.indexOf('--category');
  const value = idx >= 0 ? argv[idx + 1] : undefined;
  if (value && !value.startsWith('-')) return { category: value };
  throw new Error(
    'Usage: npx tsx scripts/catalog-harvest/harvest.ts --category <alias> | --all',
  );
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const result = await runHarvest({ ...parseArgv(argv), stdout: process.stdout });
  if (result.stoppedReason === '429' || result.stoppedReason === '403') {
    process.exit(1);
  }
}

if (isEntrypoint()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
