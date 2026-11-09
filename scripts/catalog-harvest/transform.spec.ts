import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarvestProduct } from './types';
import { transformHarvest, writeTemplate } from './transform';

function harvest(partial: Partial<HarvestProduct> & Pick<HarvestProduct, 'title'>): HarvestProduct {
  return {
    url: 'https://vendor.example/p',
    productCode: '50472',
    brand: null,
    model: null,
    status: null,
    warrantyText: null,
    breadcrumbs: ['Component', 'Processor'],
    inStock: false,
    ...partial,
  };
}

function allProducts(template: ReturnType<typeof transformHarvest>) {
  return template.groups.flatMap((g) => g.subgroups.flatMap((s) => s.products));
}

describe('transformHarvest', () => {
  it('two rows same brand+model keep one', () => {
    const first = harvest({
      title: 'AMD Ryzen 5 5600 Processor',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      status: 'Out Of Stock',
      inStock: false,
      url: 'https://vendor.example/ryzen-oos',
    });
    const second = harvest({
      title: 'AMD Ryzen 5 5600 Processor',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      status: 'In Stock',
      inStock: true,
      url: 'https://vendor.example/ryzen-in',
    });

    const products = allProducts(transformHarvest([first, second]));
    assert.equal(products.length, 1);
    assert.equal(products[0].brand, 'AMD');
    assert.equal(products[0].name, 'AMD Ryzen 5 5600 Processor');
  });

  it('AC breadcrumb dropped', () => {
    const ac = harvest({
      title: 'Gree Split AC',
      brand: 'Gree',
      model: 'Split AC',
      breadcrumbs: ['Home Appliance', 'Air Conditioner'],
      status: 'In Stock',
      inStock: true,
    });
    const cpu = harvest({
      title: 'AMD Ryzen 5 5600 Processor',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      status: 'In Stock',
      inStock: true,
    });

    const template = transformHarvest([ac, cpu]);
    const products = allProducts(template);
    assert.equal(products.length, 1);
    assert.equal(products[0].brand, 'AMD');
    assert.equal(
      products.some((p) => /gree|air conditioner|\bac\b/i.test(`${p.name} ${p.brand ?? ''}`)),
      false,
    );
  });

  it('purchasePrice === 0', () => {
    const template = transformHarvest([
      harvest({
        title: 'AOC 25G4K Gaming Monitor',
        brand: 'AOC',
        model: '25G4K',
        breadcrumbs: ['Monitor', 'AOC'],
        status: 'In Stock',
        inStock: true,
      }),
    ]);
    const products = allProducts(template);
    assert.ok(products.length >= 1);
    for (const product of products) {
      assert.equal(product.purchasePrice, 0);
    }
  });

  it('JSON.stringify of a product has no url, productCode, or image', () => {
    const row = harvest({
      title: 'AOC 25G4K Gaming Monitor',
      brand: 'AOC',
      model: '25G4K',
      breadcrumbs: ['Monitor', 'AOC'],
      status: 'In Stock',
      inStock: true,
      url: 'https://vendor.example/aoc-25g4k',
      productCode: '50472',
    });
    const withImage = { ...row, image: 'https://vendor.example/aoc.jpg' };

    const [product] = allProducts(transformHarvest([withImage]));
    const keys = Object.keys(product).sort();
    assert.deepEqual(keys, ['brand', 'name', 'purchasePrice', 'sku']);
    const encoded = JSON.stringify(product);
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    assert.equal('url' in parsed, false);
    assert.equal('productCode' in parsed, false);
    assert.equal('image' in parsed, false);
    assert.match(encoded, /"sku"/);
    assert.doesNotMatch(encoded, /"url"/);
    assert.doesNotMatch(encoded, /"productCode"/);
    assert.doesNotMatch(encoded, /"image"/);
  });

  it('subgroup with mixed stock keeps only In Stock', () => {
    const inStock = harvest({
      title: 'AMD Ryzen 5 5600 Processor',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      status: 'In Stock',
      inStock: true,
    });
    const preOrder = harvest({
      title: 'Intel Core i5 12400 Processor',
      brand: 'Intel',
      model: 'Core i5 12400',
      status: 'Pre Order',
      inStock: false,
    });
    const upcoming = harvest({
      title: 'AMD Ryzen 7 5700X Processor',
      brand: 'AMD',
      model: 'Ryzen 7 5700X',
      status: 'Up Coming',
      inStock: false,
    });

    const products = allProducts(transformHarvest([preOrder, inStock, upcoming]));
    assert.equal(products.length, 1);
    assert.equal(products[0].name, 'AMD Ryzen 5 5600 Processor');
  });

  it('subgroup with only Pre Order keeps those rows', () => {
    const preOrder = harvest({
      title: 'Intel Core i5 12400 Processor',
      brand: 'Intel',
      model: 'Core i5 12400',
      status: 'Pre Order',
      inStock: false,
    });
    const upcoming = harvest({
      title: 'AMD Ryzen 7 5700X Processor',
      brand: 'AMD',
      model: 'Ryzen 7 5700X',
      status: 'Up Coming',
      inStock: false,
    });
    const oos = harvest({
      title: 'AMD Ryzen 5 5600 Processor',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      status: 'Out Of Stock',
      inStock: false,
    });

    const products = allProducts(transformHarvest([preOrder, upcoming, oos]));
    assert.equal(products.length, 2);
    assert.deepEqual(
      products.map((p) => p.name),
      ['Intel Core i5 12400 Processor', 'AMD Ryzen 7 5700X Processor'],
    );
  });

  it('SKU for AOC/25G4K is AOC-25G4K', () => {
    const template = transformHarvest([
      harvest({
        title: 'AOC 25G4K Gaming Monitor',
        brand: 'AOC',
        model: '25G4K',
        breadcrumbs: ['Monitor', 'AOC'],
        status: 'In Stock',
        inStock: true,
      }),
    ]);
    const [product] = allProducts(template);
    assert.equal(product.sku, 'AOC-25G4K');
    assert.equal(template.businessType, 'COMPUTER_HARDWARE');
  });
});

describe('writeTemplate', () => {
  it('pretty-prints JSON.stringify(template, null, 2) plus a trailing newline', () => {
    const template = transformHarvest([
      harvest({
        title: 'AOC 25G4K Gaming Monitor',
        brand: 'AOC',
        model: '25G4K',
        breadcrumbs: ['Monitor', 'AOC'],
        status: 'In Stock',
        inStock: true,
      }),
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'catalog-transform-'));
    const outPath = join(dir, 'computer-hardware.json');
    try {
      writeTemplate(template, outPath);
      const raw = readFileSync(outPath, 'utf8');
      assert.equal(raw, `${JSON.stringify(template, null, 2)}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
