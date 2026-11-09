import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, productSku, uniqueSku } from './sku';

describe('productSku', () => {
  it('AOC + 25G4K → AOC-25G4K', () => {
    assert.equal(productSku('AOC', '25G4K'), 'AOC-25G4K');
  });
  it('missing brand → model only', () => {
    assert.equal(productSku(null, '25G4K'), '25G4K');
    assert.equal(productSku('', 'Ryzen 5 5600'), 'RYZEN-5-5600');
  });
  it('collapses punctuation and spaces', () => {
    assert.equal(slug('Ryzen 5 5600'), 'RYZEN-5-5600');
    assert.equal(slug('  aoc--25g4k  '), 'AOC-25G4K');
  });
});

describe('uniqueSku', () => {
  it('appends -2 then -3 on collision', () => {
    const taken = new Set<string>();
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K');
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K-2');
    assert.equal(uniqueSku('AOC-25G4K', taken), 'AOC-25G4K-3');
  });
  it('keeps output at or under 64 characters including a collision suffix', () => {
    const taken = new Set<string>();
    const long = 'A'.repeat(70);
    const first = uniqueSku(long, taken);
    assert.ok(first.length <= 64);
    const second = uniqueSku(long, taken);
    assert.ok(second.length <= 64);
    assert.match(second, /-\d+$/);
    assert.notEqual(first, second);
  });
});
