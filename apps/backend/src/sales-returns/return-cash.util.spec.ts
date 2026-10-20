import { returnCashOut } from './return-cash.util';

describe('returnCashOut', () => {
  it('legacy return counts its total', () => {
    expect(returnCashOut({ total_refund: 700, tenders_recorded: false, payments: [] })).toBe(700);
  });

  it('new return with Cash 500 + bKash 200 counts 500', () => {
    expect(
      returnCashOut({
        total_refund: 700,
        tenders_recorded: true,
        payments: [
          { payment_method: 'CASH', amount: 500 },
          { payment_method: 'BKASH', amount: 200 },
        ],
      }),
    ).toBe(500);
  });

  it('new return fully adjusted against due counts 0', () => {
    expect(returnCashOut({ total_refund: 700, tenders_recorded: true, payments: [] })).toBe(0);
  });

  it('reads decimal-like amounts and sums several cash rows', () => {
    expect(
      returnCashOut({
        total_refund: '900',
        tenders_recorded: true,
        payments: [
          { payment_method: 'CASH', amount: '100.50' },
          { payment_method: 'CASH', amount: 200 },
        ],
      }),
    ).toBe(300.5);
  });
});
