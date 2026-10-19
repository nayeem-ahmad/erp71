import { availableAt, isAvailableAt, offeredAt, isOfferedAt } from './payment-method-branches';

describe('offeredAt', () => {
  it('is all branches or a join row at one of the ids, with no is_active', () => {
    expect(offeredAt(['s1', 's2'])).toEqual({
      OR: [{ all_branches: true }, { stores: { some: { store_id: { in: ['s1', 's2'] } } } }],
    });
  });
});

describe('isOfferedAt', () => {
  it('includes an inactive method offered at the branch and excludes one limited to another', () => {
    expect(isOfferedAt({ all_branches: false, stores: [{ store_id: 's1' }] }, 's1')).toBe(true);
    expect(isOfferedAt({ all_branches: false, stores: [{ store_id: 's2' }] }, 's1')).toBe(false);
    expect(isOfferedAt({ all_branches: true, stores: [] }, 's1')).toBe(true);
  });
});

describe('availableAt', () => {
  it('is active and (all branches or a join row at one of the ids)', () => {
    expect(availableAt(['s1', 's2'])).toEqual({
      is_active: true,
      OR: [{ all_branches: true }, { stores: { some: { store_id: { in: ['s1', 's2'] } } } }],
    });
  });
});

describe('isAvailableAt', () => {
  const m = (over: Partial<Parameters<typeof isAvailableAt>[0]>) => ({
    is_active: true, all_branches: true, stores: [], ...over,
  });

  it('offers an all-branch method everywhere', () => {
    expect(isAvailableAt(m({}), 's9')).toBe(true);
  });
  it('offers a limited method only at its branches', () => {
    const limited = m({ all_branches: false, stores: [{ store_id: 's1' }] });
    expect(isAvailableAt(limited, 's1')).toBe(true);
    expect(isAvailableAt(limited, 's2')).toBe(false);
  });
  it('offers a limited method with no branch rows nowhere', () => {
    expect(isAvailableAt(m({ all_branches: false }), 's1')).toBe(false);
  });
  it('never offers an inactive method', () => {
    expect(isAvailableAt(m({ is_active: false }), 's1')).toBe(false);
  });
});
