import { printBranch, publishPrintBranch, withdrawPrintBranch } from './print-branch';

describe('print branch', () => {
    afterEach(() => {
        withdrawPrintBranch(pageA);
        withdrawPrintBranch(pageB);
    });

    const pageA = Symbol('page A');
    const pageB = Symbol('page B');

    it('is unset until a page publishes its branch', () => {
        expect(printBranch()).toBeUndefined();
    });

    it('reads back the branch the page published', () => {
        publishPrintBranch(pageA, 's1');

        expect(printBranch()).toBe('s1');
    });

    it('follows the page when its filter moves to another branch, or to all of them', () => {
        publishPrintBranch(pageA, 's1');
        publishPrintBranch(pageA, 's2');
        expect(printBranch()).toBe('s2');

        publishPrintBranch(pageA, undefined);
        expect(printBranch()).toBeUndefined();
    });

    /*
     * Navigating mounts the next page before the last one's cleanup may run,
     * so a late withdrawal must not wipe the branch the new page published.
     */
    it('ignores a withdrawal from a page that no longer owns it', () => {
        publishPrintBranch(pageA, 's1');
        publishPrintBranch(pageB, 's2');

        withdrawPrintBranch(pageA);

        expect(printBranch()).toBe('s2');
    });

    it('clears when the owning page withdraws', () => {
        publishPrintBranch(pageA, 's1');

        withdrawPrintBranch(pageA);

        expect(printBranch()).toBeUndefined();
    });
});
