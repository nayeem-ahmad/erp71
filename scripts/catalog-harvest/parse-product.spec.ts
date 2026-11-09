import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListingPage, parseProductPage } from './parse-product';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseProductPage', () => {
  it('reads brand, model, stock, breadcrumbs, and product code from the AOC fixture', () => {
    const html = readFixture('product-aoc-25g4k.html');
    const product = parseProductPage(html, '/aoc-25g4k');

    assert.equal(product.brand, 'AOC');
    assert.equal(product.model, '25G4K');
    assert.equal(product.inStock, true);
    assert.ok(product.breadcrumbs.includes('Monitor'));
    assert.ok(product.breadcrumbs.includes('AOC'));
    assert.equal(product.productCode, '50472');
    assert.equal(product.title, 'AOC 25G4K Gaming Monitor');
    assert.doesNotMatch(product.title, /Price in Bangladesh/i);
  });
});

describe('parseListingPage', () => {
  it('returns product URLs and a page=2 next link', () => {
    const html = readFixture('listing-processor.html');
    const listing = parseListingPage(html, '/component/processor');

    assert.ok(listing.productUrls.some((url) => url.includes('/amd-ryzen-5-5600')));
    assert.ok(listing.productUrls.some((url) => url.includes('/aoc-25g4k')));
    assert.ok(listing.nextPage && listing.nextPage.includes('page=2'));
  });
});
