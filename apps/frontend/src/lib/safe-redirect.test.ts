import { safeAppPath } from './safe-redirect';

describe('safeAppPath', () => {
    it('keeps an ordinary in-app path', () => {
        expect(safeAppPath('/sales/pos')).toBe('/sales/pos');
        expect(safeAppPath('/inventory/products?page=2')).toBe('/inventory/products?page=2');
    });

    it('falls back when there is no path at all', () => {
        expect(safeAppPath(null)).toBe('/dashboard');
        expect(safeAppPath(undefined)).toBe('/dashboard');
        expect(safeAppPath('')).toBe('/dashboard');
    });

    it('honours a caller-supplied fallback', () => {
        expect(safeAppPath(null, '/select-account')).toBe('/select-account');
    });

    it('rejects an absolute URL', () => {
        expect(safeAppPath('https://evil.example/login')).toBe('/dashboard');
        expect(safeAppPath('javascript:alert(1)')).toBe('/dashboard');
    });

    it('rejects a protocol-relative URL, which starts with a slash but leaves the origin', () => {
        expect(safeAppPath('//evil.example')).toBe('/dashboard');
        expect(safeAppPath('//evil.example/dashboard')).toBe('/dashboard');
    });

    it('rejects a backslash host, which browsers normalise into a protocol-relative URL', () => {
        expect(safeAppPath('/\\evil.example')).toBe('/dashboard');
    });

    it('judges a path the way the URL parser will, after control characters are stripped', () => {
        // The browser drops the newline and is then looking at `//evil.example`.
        expect(safeAppPath('/\n/evil.example')).toBe('/dashboard');
        expect(safeAppPath('\t/sales')).toBe('/sales');
        expect(safeAppPath(' /sales')).toBe('/sales');
    });

    it('rejects a bare relative path', () => {
        expect(safeAppPath('sales/pos')).toBe('/dashboard');
    });
});
