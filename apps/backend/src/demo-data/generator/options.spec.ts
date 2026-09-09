import {
    DEFAULT_DEMO_MONTHS,
    DEMO_MODULE_GROUPS,
    MAX_DEMO_MONTHS,
    MIN_DEMO_MONTHS,
    moduleEnabled,
    resolveDemoOptions,
} from './options';

describe('resolveDemoOptions', () => {
    it('defaults to the full dataset when nothing is asked for', () => {
        const options = resolveDemoOptions();
        expect(options.months).toBe(DEFAULT_DEMO_MONTHS);
        expect(options.modules).toEqual([...DEMO_MODULE_GROUPS]);
        expect(options.includeAnomalies).toBe(true);
    });

    it('clamps the month count into range rather than rejecting it', () => {
        // A demo load is not the place to argue with the operator: an out-of-range
        // month count still produces a dataset.
        expect(resolveDemoOptions({ months: 0 }).months).toBe(MIN_DEMO_MONTHS);
        expect(resolveDemoOptions({ months: 99 }).months).toBe(MAX_DEMO_MONTHS);
        expect(resolveDemoOptions({ months: 3.4 }).months).toBe(3);
        expect(resolveDemoOptions({ months: '2' }).months).toBe(2);
        expect(resolveDemoOptions({ months: Number.NaN }).months).toBe(DEFAULT_DEMO_MONTHS);
    });

    it('keeps only recognised module names, and always keeps core', () => {
        const options = resolveDemoOptions({ modules: ['CRM', ' hr ', 'not-a-module'] });
        expect(options.modules).toEqual(['core', 'crm', 'hr']);
    });

    it('treats an empty or entirely unrecognised selection as everything', () => {
        // A batch that wrote nothing but core sales would look like a failure to
        // whoever clicked Load.
        expect(resolveDemoOptions({ modules: [] }).modules).toEqual([...DEMO_MODULE_GROUPS]);
        expect(resolveDemoOptions({ modules: ['nonsense'] }).modules).toEqual([...DEMO_MODULE_GROUPS]);
    });

    it('only switches anomalies off on an explicit false', () => {
        expect(resolveDemoOptions({ includeAnomalies: false }).includeAnomalies).toBe(false);
        expect(resolveDemoOptions({ includeAnomalies: undefined }).includeAnomalies).toBe(true);
        expect(resolveDemoOptions({}).includeAnomalies).toBe(true);
    });

    it('does not hand back a shared modules array', () => {
        const first = resolveDemoOptions();
        first.modules.push('crm');
        expect(resolveDemoOptions().modules).toEqual([...DEMO_MODULE_GROUPS]);
    });
});

describe('moduleEnabled', () => {
    it('reports core as on even when it was not selected', () => {
        const options = resolveDemoOptions({ modules: ['crm'] });
        expect(moduleEnabled(options, 'core')).toBe(true);
        expect(moduleEnabled(options, 'crm')).toBe(true);
        expect(moduleEnabled(options, 'hr')).toBe(false);
    });
});
