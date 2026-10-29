import { isCashDrawer } from './cash-drawer';

describe('isCashDrawer', () => {
    const wallets = new Set(['upay-id']);

    it('is false for a bank', () => {
        expect(isCashDrawer({ id: 'bank', name: 'Premier Bank', category: 'bank' }, wallets)).toBe(false);
    });

    it('is false for bKash Account', () => {
        expect(isCashDrawer({ id: 'bkash', name: 'bKash Account', category: 'cash' }, wallets)).toBe(false);
    });

    it('is false for a cash account linked from a mobile wallet', () => {
        expect(isCashDrawer({ id: 'upay-id', name: 'Upay', category: 'cash' }, wallets)).toBe(false);
    });

    it('is true for a plain cash account', () => {
        expect(isCashDrawer({ id: 'cf', name: 'Main Cash (CF)', category: 'cash' }, wallets)).toBe(true);
    });
});
