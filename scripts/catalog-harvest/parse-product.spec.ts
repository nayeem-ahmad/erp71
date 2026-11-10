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
  it('reads brand, model, stock, breadcrumbs, and product code from the live processor fixture', () => {
    const html = readFixture('product-amd-ryzen-5-5600.html');
    const product = parseProductPage(html, '/amd-ryzen-5-5600-processor');

    assert.equal(product.brand, 'AMD');
    assert.equal(product.model, 'Ryzen 5 5600 (Tray Box)');
    assert.equal(product.inStock, true);
    assert.ok(product.breadcrumbs.includes('Processor'));
    assert.ok(product.breadcrumbs.includes('AMD'));
    assert.equal(product.productCode, '23200');
    assert.equal(product.title, 'AMD Ryzen 5 5600 Processor');
    assert.doesNotMatch(product.title, /Price in Bangladesh/i);
  });
});

describe('parseListingPage', () => {
  it('returns product URLs and a page=2 next link', () => {
    const html = readFixture('listing-processor.html');
    const listing = parseListingPage(html, '/component/processor');

    assert.ok(listing.productUrls.some((url) => url.includes('/amd-ryzen-5-5600')));
    assert.ok(listing.productUrls.some((url) => url.includes('/amd-ryzen-5-7500f')));
    assert.ok(listing.nextPage && listing.nextPage.includes('page=2'));
  });
});
