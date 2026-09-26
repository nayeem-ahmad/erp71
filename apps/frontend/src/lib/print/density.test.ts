import { PRINT_DENSITY_KEY, PRINT_DENSITY_MESSAGE } from './density';

type DensityModule = typeof import('./density');

/** A fresh copy of the module — it holds the session fallback and the listener flag. */
function load(): DensityModule {
    let mod: DensityModule | undefined;
    jest.isolateModules(() => {
        mod = require('./density');
    });
    return mod!;
}

beforeEach(() => {
    // Restore first: a test below makes storage throw.
    jest.restoreAllMocks();
    window.localStorage.clear();
});

describe('remembered print density', () => {
    it('starts at normal', () => {
        expect(load().readPrintDensity()).toBe('normal');
    });

    it('remembers compact across page loads', () => {
        load().setPrintDensity('compact');

        expect(window.localStorage.getItem(PRINT_DENSITY_KEY)).toBe('compact');
        // A new page reads it back from storage, not from memory.
        expect(load().readPrintDensity()).toBe('compact');
    });

    it('ignores a value it did not write', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'tiny');

        expect(load().readPrintDensity()).toBe('normal');
    });

    it('still holds the choice for this page when storage is locked', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        const density = load();

        expect(() => density.setPrintDensity('compact')).not.toThrow();
        expect(density.readPrintDensity()).toBe('compact');
    });

    it('tells subscribers when it changes, until they unsubscribe', () => {
        const density = load();
        const listener = jest.fn();
        const unsubscribe = density.subscribePrintDensity(listener);

        density.setPrintDensity('compact');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        density.setPrintDensity('normal');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('follows a change made in another tab', () => {
        const density = load();
        const listener = jest.fn();
        density.subscribePrintDensity(listener);

        window.dispatchEvent(new StorageEvent('storage', { key: PRINT_DENSITY_KEY }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));

        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('the print window reporting back', () => {
    it('stores the choice a print window posts', () => {
        const density = load();
        density.listenForPrintWindowDensity();

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: PRINT_DENSITY_MESSAGE, density: 'compact' },
        }));

        expect(density.readPrintDensity()).toBe('compact');
        expect(window.localStorage.getItem(PRINT_DENSITY_KEY)).toBe('compact');
    });

    it('ignores other messages and values it does not know', () => {
        const density = load();
        density.listenForPrintWindowDensity();

        window.dispatchEvent(new MessageEvent('message', { data: { type: 'other', density: 'compact' } }));
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: PRINT_DENSITY_MESSAGE, density: 'huge' },
        }));

        expect(density.readPrintDensity()).toBe('normal');
    });

    it('installs its listener only once', () => {
        const add = jest.spyOn(window, 'addEventListener');
        const density = load();

        density.listenForPrintWindowDensity();
        density.listenForPrintWindowDensity();

        expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1);
    });
});
