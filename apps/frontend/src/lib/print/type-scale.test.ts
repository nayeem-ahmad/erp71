import { DEFAULT_SECTION_VALUES, type DevicePrefs } from '@erp71/shared-types';
import { PRINT_TYPE_SCALE_KEY, PRINT_TYPE_SCALE_MESSAGE } from './type-scale';
import { signInForPreferences } from '@/test-utils/preferences-scope';

jest.mock('@/lib/api', () => ({ api: {} }));

type ScaleModule = typeof import('./type-scale');
type StoreModule = typeof import('@/lib/preferences/store');

/** A fresh copy of type-scale with the preferences store it reads, holding `device` as the profile's. */
function loadWithProfile(device: DevicePrefs): ScaleModule {
    let mod: ScaleModule | undefined;
    jest.isolateModules(() => {
        mod = require('./type-scale');
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
function load(): ScaleModule {
    let mod: ScaleModule | undefined;
    jest.isolateModules(() => {
        mod = require('./type-scale');
    });
    return mod!;
}

beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    signInForPreferences('t1:u1');
});

describe('remembered print text size', () => {
    it('starts at normal', () => {
        expect(load().readPrintTypeScale()).toBe('normal');
    });

    it('remembers a larger size across page loads', () => {
        load().setPrintTypeScale('larger');

        expect(window.localStorage.getItem(PRINT_TYPE_SCALE_KEY)).toBe('larger');
        expect(load().readPrintTypeScale()).toBe('larger');
    });

    it('ignores a value it did not write', () => {
        window.localStorage.setItem(PRINT_TYPE_SCALE_KEY, 'huge');

        expect(load().readPrintTypeScale()).toBe('normal');
    });

    it('still holds the choice for this page when storage is locked', () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('locked');
        });
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('locked');
        });

        const mod = load();
        mod.setPrintTypeScale('large');

        expect(mod.readPrintTypeScale()).toBe('large');
    });

    it('takes the size a print window posts back, and nothing else', () => {
        const mod = load();
        mod.listenForPrintWindowTypeScale();

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: PRINT_TYPE_SCALE_MESSAGE, typeScale: 'large' },
        }));
        expect(mod.readPrintTypeScale()).toBe('large');

        window.dispatchEvent(new MessageEvent('message', {
            data: { type: PRINT_TYPE_SCALE_MESSAGE, typeScale: 'tiny' },
        }));
        expect(mod.readPrintTypeScale()).toBe('large');
    });
});

describe('a new browser starts from the profile', () => {
    it('stored → profile → normal: the browser answer wins over the profile', () => {
        window.localStorage.setItem(PRINT_TYPE_SCALE_KEY, 'normal');

        expect(loadWithProfile({ printTypeScale: 'larger' }).readPrintTypeScale()).toBe('normal');
    });

    it('uses the profile when this browser has nothing stored', () => {
        expect(loadWithProfile({ printTypeScale: 'larger' }).readPrintTypeScale()).toBe('larger');
    });

    it('uses the profile when the stored value is not one it wrote', () => {
        window.localStorage.setItem(PRINT_TYPE_SCALE_KEY, 'huge');

        expect(loadWithProfile({ printTypeScale: 'large' }).readPrintTypeScale()).toBe('large');
    });

    it('nothing is written to localStorage when the profile value is used', () => {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');

        loadWithProfile({ printTypeScale: 'larger' }).readPrintTypeScale();

        expect(setItem).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(PRINT_TYPE_SCALE_KEY)).toBeNull();
    });

    it('no profile device fields → today\'s behaviour exactly', () => {
        const scale = loadWithProfile({ printDensity: 'compact' });

        expect(scale.readPrintTypeScale()).toBe('normal');
        scale.setPrintTypeScale('large');
        expect(scale.readPrintTypeScale()).toBe('large');
    });
});
