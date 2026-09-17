import { BadRequestException } from '@nestjs/common';
import {
  assertSessionForPosSale,
  findOpenSessionForUser,
  requiresCashierSession,
} from './active-session.util';

describe('findOpenSessionForUser', () => {
  it('asks for this tenant, this user, still open', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'sess-1', counter_id: 'c1', store_id: 'st1' });

    const session = await findOpenSessionForUser({ cashierSession: { findFirst } } as any, 't1', 'u1');

    expect(session).toEqual({ id: 'sess-1', counter_id: 'c1', store_id: 'st1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 't1', user_id: 'u1', status: 'OPEN' },
      select: { id: true, counter_id: true, store_id: true },
    });
  });

  it('returns null rather than throwing when nobody has a shift open', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      findOpenSessionForUser({ cashierSession: { findFirst } } as any, 't1', 'u1'),
    ).resolves.toBeNull();
  });
});

describe('requiresCashierSession', () => {
  it('is off when the tenant has no sales settings row yet', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);

    await expect(
      requiresCashierSession({ salesSettings: { findUnique } } as any, 't1'),
    ).resolves.toBe(false);
  });

  it('reads the row without creating one', async () => {
    const findUnique = jest.fn().mockResolvedValue({ require_cashier_session: true });

    await expect(
      requiresCashierSession({ salesSettings: { findUnique } } as any, 't1'),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenant_id: 't1' },
      select: { require_cashier_session: true },
    });
  });
});

describe('assertSessionForPosSale', () => {
  it('stops a counter sale with no shift open when the tenant asks for one', () => {
    expect(() => assertSessionForPosSale(null, true, true)).toThrow(BadRequestException);
    expect(() => assertSessionForPosSale(null, true, true)).toThrow(
      'Open a cashier session before selling at the counter.',
    );
  });

  it('lets the same sale through once a shift is open', () => {
    expect(() => assertSessionForPosSale({ id: 'sess-1' }, true, true)).not.toThrow();
  });

  it('never blocks a tenant that has not turned the requirement on', () => {
    expect(() => assertSessionForPosSale(null, false, true)).not.toThrow();
  });

  it('never blocks a back-office invoice, which has no till to be open', () => {
    expect(() => assertSessionForPosSale(null, true, false)).not.toThrow();
  });
});
