import { PRINT_TYPE_SCALE_KEY, PRINT_TYPE_SCALE_MESSAGE } from './type-scale';

type ScaleModule = typeof import('./type-scale');

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
