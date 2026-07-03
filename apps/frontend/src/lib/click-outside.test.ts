import { isAppNavigationTarget } from './click-outside';

describe('isAppNavigationTarget', () => {
    it('returns true for sidebar links', () => {
        document.body.innerHTML = '<aside><a href="/dashboard">Dashboard</a></aside>';
        const link = document.querySelector('a')!;
        expect(isAppNavigationTarget(link)).toBe(true);
    });

    it('returns true for nav links', () => {
        document.body.innerHTML = '<nav><a href="/sales">Sales</a></nav>';
        const link = document.querySelector('a')!;
        expect(isAppNavigationTarget(link)).toBe(true);
    });

    it('returns false for main content clicks', () => {
        document.body.innerHTML = '<main><button type="button">Add</button></main>';
        const button = document.querySelector('button')!;
        expect(isAppNavigationTarget(button)).toBe(false);
    });
});