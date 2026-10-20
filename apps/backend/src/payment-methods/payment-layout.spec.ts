import { readLayoutEntry, resolvePaymentLayout, setLayoutEntry } from './payment-layout';

const m = (id: string, sort_order: number, show_on_entry = true) => ({ id, sort_order, show_on_entry });

describe('resolvePaymentLayout', () => {
  const available = [m('cash', 1), m('bank', 2, false), m('bkash', 3), m('nagad', 4)];

  it('no entry → show_on_entry methods by sort_order', () => {
    const r = resolvePaymentLayout(available, undefined);
    expect(r.customised).toBe(false);
    expect(r.visible.map((x) => x.id)).toEqual(['cash', 'bkash', 'nagad']);
  });

  it('entry → order kept, hidden removed', () => {
    const r = resolvePaymentLayout(available, { order: ['nagad', 'bank', 'cash', 'bkash'], hidden: ['cash'] });
    expect(r.customised).toBe(true);
    expect(r.visible.map((x) => x.id)).toEqual(['nagad', 'bank', 'bkash']);
  });

  it('a method added since is appended visible, in sort_order', () => {
    const r = resolvePaymentLayout(available, { order: ['bkash', 'cash'], hidden: [] });
    expect(r.visible.map((x) => x.id)).toEqual(['bkash', 'cash', 'bank', 'nagad']);
  });

  it('unavailable ids are skipped', () => {
    const r = resolvePaymentLayout(available, { order: ['gone', 'cash', 'bkash'], hidden: ['also-gone'] });
    expect(r.visible.map((x) => x.id)).toEqual(['cash', 'bkash', 'bank', 'nagad']);
  });
});

describe('setLayoutEntry / readLayoutEntry', () => {
  const entry = { order: ['a', 'b'], hidden: ['b'] };

  it('leaves other branches and contexts untouched', () => {
    const prefs = {
      s1: { sale: { order: ['x'], hidden: [] }, purchase: { order: ['y'], hidden: [] } },
      s2: { sale: { order: ['z'], hidden: [] } },
    };
    const next = setLayoutEntry(prefs, 's1', 'sale', entry);
    expect(next.s1!.sale).toEqual(entry);
    expect(next.s1!.purchase).toEqual(prefs.s1.purchase);
    expect(next.s2).toEqual(prefs.s2);
    expect(prefs.s1.sale.order).toEqual(['x']);
  });

  it('null entry removes the key, and the branch key once empty', () => {
    const prefs = { s1: { sale: entry, purchase: entry }, s2: { sale: entry } };
    const one = setLayoutEntry(prefs, 's1', 'sale', null);
    expect(one.s1).toEqual({ purchase: entry });
    const two = setLayoutEntry(one, 's1', 'purchase', null);
    expect(two).toEqual({ s2: { sale: entry } });
  });

  it('prefs that is not an object reads as {}', () => {
    expect(setLayoutEntry(null, 's1', 'sale', entry)).toEqual({ s1: { sale: entry } });
    expect(setLayoutEntry('junk', 's1', 'sale', entry)).toEqual({ s1: { sale: entry } });
    expect(setLayoutEntry([1], 's1', 'sale', null)).toEqual({});
    expect(readLayoutEntry(undefined, 's1', 'sale')).toBeUndefined();
    expect(readLayoutEntry({ s1: { sale: entry } }, 's1', 'sale')).toEqual(entry);
    expect(readLayoutEntry({ s1: { sale: entry } }, 's1', 'purchase')).toBeUndefined();
  });
});
