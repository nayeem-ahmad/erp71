import { parse, type HTMLElement } from 'node-html-parser';
import type { HarvestProduct } from './types';

export type { HarvestProduct };

/** CSS selectors for OpenCart-like listing and product pages. */
const SELECTORS = {
  title: 'h1.product-name, h1',
  breadcrumbs: 'ul.breadcrumb li',
  infoRows: 'table.product-info-table tr, table.data-table tr',
  keyFeatures: '.short-description li',
  productLinks: '.p-item .p-item-name a',
  pagination: '.pagination a',
} as const;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textOf(el: HTMLElement | null | undefined): string {
  return collapseWs(el?.text ?? '');
}

function labeledFromRows(root: HTMLElement, label: string): string | null {
  const want = label.toLowerCase();
  for (const tr of root.querySelectorAll(SELECTORS.infoRows)) {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length < 2) continue;
    const key = textOf(cells[0]).replace(/:$/, '').toLowerCase();
    if (key !== want && !key.endsWith(` ${want}`)) continue;
    const value = textOf(cells[1]);
    return value || null;
  }
  return null;
}

function labeledFromList(root: HTMLElement, selector: string, label: string): string | null {
  const re = new RegExp(`^${escapeRe(label)}\\s*:\\s*(.*)$`, 'i');
  for (const li of root.querySelectorAll(selector)) {
    const match = textOf(li).match(re);
    if (!match) continue;
    const value = collapseWs(match[1] ?? '');
    return value || null;
  }
  return null;
}

function parseTitle(root: HTMLElement): string {
  return textOf(root.querySelector(SELECTORS.title)).replace(
    /\s*Price in Bangladesh\s*$/i,
    '',
  );
}

function parseBreadcrumbs(root: HTMLElement): string[] {
  return root
    .querySelectorAll(SELECTORS.breadcrumbs)
    .map((li) => textOf(li))
    .filter((crumb) => crumb && !/^home$/i.test(crumb));
}

function parseModel(root: HTMLElement, title: string, brand: string | null): string | null {
  const fromFeatures = labeledFromList(root, SELECTORS.keyFeatures, 'Model');
  if (fromFeatures) return fromFeatures;
  if (!title) return null;
  if (!brand) return title;
  const stripped = title.replace(new RegExp(`^${escapeRe(brand)}\\b\\s*`, 'i'), '').trim();
  return stripped || null;
}

function resolveHref(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function pageNumberFromUrl(url: string): number | null {
  const match = url.match(/[?&]page=(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseProductPage(html: string, url: string): HarvestProduct {
  const root = parse(html);
  const title = parseTitle(root);
  const brand = labeledFromRows(root, 'Brand');
  const status = labeledFromRows(root, 'Status');
  const productCode = labeledFromRows(root, 'Product Code');
  const warrantyText =
    labeledFromRows(root, 'Warranty') ??
    labeledFromList(root, SELECTORS.keyFeatures, 'Warranty');

  return {
    url,
    productCode,
    title,
    brand,
    model: parseModel(root, title, brand),
    status,
    warrantyText,
    breadcrumbs: parseBreadcrumbs(root),
    inStock: /in stock/i.test(status ?? ''),
  };
}

export function parseListingPage(
  html: string,
  pageUrl: string,
): { productUrls: string[]; nextPage: string | null } {
  const root = parse(html);
  const productUrls: string[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll(SELECTORS.productLinks)) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const url = resolveHref(href, pageUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    productUrls.push(url);
  }

  const currentPage = pageNumberFromUrl(pageUrl) ?? 1;
  let nextPage: string | null = null;
  let nextNum = Infinity;
  for (const a of root.querySelectorAll(SELECTORS.pagination)) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const resolved = resolveHref(href, pageUrl);
    const n = pageNumberFromUrl(href) ?? pageNumberFromUrl(resolved);
    if (n == null || n <= currentPage || n >= nextNum) continue;
    nextNum = n;
    nextPage = resolved;
  }

  return { productUrls, nextPage };
}
