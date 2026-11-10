import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mapCategory } from './category-map';
import { productSku, uniqueSku } from './sku';
import type { HarvestProduct } from './types';

export type TemplateProduct = {
  sku: string;
  name: string;
  purchasePrice: number;
  brand: string | null;
};

export type TemplateData = {
  businessType: 'COMPUTER_HARDWARE';
  groups: Array<{
    name: string;
    subgroups: Array<{ name: string; products: TemplateProduct[] }>;
  }>;
};

const GROUP_ORDER = [
  'Components',
  'Storage',
  'Laptop',
  'Desktop',
  'Monitors',
  'Peripherals',
  'Networking',
  'Power',
  'Accessories',
] as const;

type MappedRow = HarvestProduct & { group: string; subgroup: string };

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function dedupeKey(row: HarvestProduct): string {
  const brand = normalise(row.brand ?? '');
  const model = normalise(row.model ?? row.title);
  const key = `${brand}\t${model}`;
  return key.trim() ? key : normalise(row.title);
}

function isPreOrderOrUpcoming(row: HarvestProduct): boolean {
  const status = row.status ?? '';
  return /pre[\s-]*order/i.test(status) || /up\s*coming/i.test(status);
}

function filterStock(rows: MappedRow[]): MappedRow[] {
  if (rows.some((row) => row.inStock)) return rows.filter((row) => row.inStock);
  return rows.filter(isPreOrderOrUpcoming);
}

function toProduct(row: HarvestProduct, taken: Set<string>): TemplateProduct {
  return {
    sku: uniqueSku(productSku(row.brand, row.model ?? row.title), taken),
    name: row.title,
    purchasePrice: 0,
    brand: row.brand,
  };
}

export function transformHarvest(rows: HarvestProduct[]): TemplateData {
  const kept = new Map<string, MappedRow>();
  for (const row of rows) {
    const mapped = mapCategory({ breadcrumbs: row.breadcrumbs, url: row.url, title: row.title });
    if (!mapped) continue;
    const key = dedupeKey(row);
    const existing = kept.get(key);
    if (existing && (existing.inStock || !row.inStock)) continue;
    kept.set(key, { ...row, group: mapped.group, subgroup: mapped.subgroup });
  }

  const grouped = new Map<string, Map<string, MappedRow[]>>();
  for (const row of kept.values()) {
    let subgroups = grouped.get(row.group);
    if (!subgroups) {
      subgroups = new Map();
      grouped.set(row.group, subgroups);
    }
    let products = subgroups.get(row.subgroup);
    if (!products) {
      products = [];
      subgroups.set(row.subgroup, products);
    }
    products.push(row);
  }

  const taken = new Set<string>();
  const groups: TemplateData['groups'] = [];
  for (const groupName of GROUP_ORDER) {
    const subgroups = grouped.get(groupName);
    if (!subgroups) continue;
    const subgroupList: TemplateData['groups'][number]['subgroups'] = [];
    for (const [subgroupName, products] of subgroups) {
      const surviving = filterStock(products);
      if (surviving.length === 0) continue;
      subgroupList.push({
        name: subgroupName,
        products: surviving.map((row) => toProduct(row, taken)),
      });
    }
    if (subgroupList.length === 0) continue;
    groups.push({ name: groupName, subgroups: subgroupList });
  }

  return { businessType: 'COMPUTER_HARDWARE', groups };
}

export function writeTemplate(template: TemplateData, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
}

function readJsonlDir(dir: string): HarvestProduct[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const rows: HarvestProduct[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.jsonl')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      rows.push(JSON.parse(trimmed) as HarvestProduct);
    }
  }
  return rows;
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

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rows = readJsonlDir(join(here, 'raw'));
  const template = transformHarvest(rows);
  writeTemplate(
    template,
    join(here, '..', '..', 'packages', 'database', 'prisma', 'templates', 'computer-hardware.json'),
  );
}

if (isEntrypoint()) {
  main();
}
