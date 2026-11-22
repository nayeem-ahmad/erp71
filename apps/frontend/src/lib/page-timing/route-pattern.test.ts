import { endpointPattern, routePattern } from './route-pattern';

describe('routePattern', () => {
    it('replaces ids and drops the query string and trailing slash', () => {
        expect(routePattern('/sales/3f2c9a1e-0000-4000-8000-000000000001?tab=items')).toBe('/sales/:id');
        expect(routePattern('/customers/123/edit/')).toBe('/customers/:id/edit');
        expect(routePattern('/products/ckq9x8w7v0000abcd1234efgh')).toBe('/products/:id');
        expect(routePattern('https://app.erp71.com/accounting/reports#top')).toBe('/accounting/reports');
    });

    it('keeps ordinary words', () => {
        expect(routePattern('/admin/system-health')).toBe('/admin/system-health');
        expect(routePattern('/inventory/stock-adjustments')).toBe('/inventory/stock-adjustments');
        expect(routePattern('/')).toBe('/');
    });
});

describe('endpointPattern', () => {
    it('prefixes the method', () => {
        expect(endpointPattern(undefined, '/customers/42?page=2')).toBe('GET /customers/:id');
        expect(endpointPattern('post', '/sales')).toBe('POST /sales');
    });
});
