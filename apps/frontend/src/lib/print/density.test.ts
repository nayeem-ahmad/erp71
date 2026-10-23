import { DEFAULT_SECTION_VALUES, type DevicePrefs } from '@erp71/shared-types';
import { PRINT_DENSITY_KEY, PRINT_DENSITY_MESSAGE } from './density';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({ api: {} }));

type DensityModule = typeof import('./density');
type StoreModule = typeof import('@/lib/preferences/store');

/** A fresh copy of density with the preferences store it reads, holding `device` as the profile's. */
function loadWithProfile(device: DevicePrefs): DensityModule {
    let mod: DensityModule | undefined;
    jest.isolateModules(() => {
        mod = require('./density');
        const { usePreferencesStore } = require('@/lib/preferences/store') as StoreModule;
        usePreferencesStore.getState().hydrate('t1:u1', {
            profile: { id: 'p1', name: 'Cashier' },
            legacy_browser_sections: [],
            sections: {
                invoicePrint: { value: DEFAULT_SECTION_VALUES.invoicePrint, source: 'default' },
                tableView: { value: DEFAULT_SECTION_VALUES.tableView, source: 'default' },
                tableColumns: { value: {}, source: 'default' },
                sidebar: { value: DEFAULT_SECTION_VALUES.sidebar, source: 'default' },
                alerts: { value: DEFAULT_SECTION_VALUES.alerts, source: 'default' },
                device: { value: device, source: 'profile' },
            },
        });
    });
    return mod!;
}

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
    window.sessionStorage.clear();
    signInForPreferences('t1:u1');
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

describe('a new browser starts from the profile', () => {
    it('stored → profile → normal: the browser answer wins over the profile', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'normal');

        expect(loadWithProfile({ printDensity: 'compact' }).readPrintDensity()).toBe('normal');
    });

    it('uses the profile when this browser has nothing stored', () => {
        expect(loadWithProfile({ printDensity: 'compact' }).readPrintDensity()).toBe('compact');
    });

    it('uses the profile when the stored value is not one it wrote', () => {
        window.localStorage.setItem(PRINT_DENSITY_KEY, 'tiny');

        expect(loadWithProfile({ printDensity: 'compact' }).readPrintDensity()).toBe('compact');
    });

    it('uses the profile when this browser\'s density cannot be read', () => {
        // Only the density key: with every read failing there is no token or workspace to
        // say whose profile the store holds, so no profile would be trusted at all.
        const getItem = Storage.prototype.getItem;
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
            if (key === PRINT_DENSITY_KEY) throw new Error('SecurityError');
            return getItem.call(this, key);
        });

        expect(loadWithProfile({ printDensity: 'compact' }).readPrintDensity()).toBe('compact');
    });

    it('nothing is written to localStorage when the profile value is used', () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');

        loadWithProfile({ printDensity: 'compact' }).readPrintDensity();

        expect(setItem).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PRINT_DENSITY_KEY)).toBeNull();
    });

    it('no profile device fields → today\'s behaviour exactly', () => {
        const density = loadWithProfile({ printTypeScale: 'large' });

        expect(density.readPrintDensity()).toBe('normal');
        density.setPrintDensity('compact');
        expect(density.readPrintDensity()).toBe('compact');
    });
});
