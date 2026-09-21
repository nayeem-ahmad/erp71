import { buildCustomerCandidates, buildProductCandidates, buildSupplierCandidates } from './candidates';
import type { ExistingRecord } from './match.types';

const SOURCE = 'ExpressRetail';

describe('buildProductCandidates', () => {
    const existing: ExistingRecord[] = [
        { id: 'p1', name: 'Square Napa 500 mg', sku: 'SKU-1' },
        { id: 'p2', name: 'Napa 665mg', sku: 'SKU-2' },
        { id: 'p3', name: 'Hand Sanitizer', sku: 'SKU-3' },
    ];

    it('matches across a brand prefix within the same block', () => {
        const [row] = buildProductCandidates([{ externalId: '1', name: 'Napa 500mg' }], existing, SOURCE);
        expect(row.matchId).toBe('p1');
        expect(row.confidence).toBe('high');
        expect(row.decision).toBe('accept');
    });

    it('NEVER matches a different strength', () => {
        const [row] = buildProductCandidates([{ externalId: '2', name: 'Napa 250mg' }], existing, SOURCE);
        expect(row.matchId).toBeNull();
        expect(row.confidence).toBe('none');
        expect(row.decision).toBe('new');
    });

    it('does not offer a measureless product as a candidate for a measured one', () => {
        const [row] = buildProductCandidates(
            [{ externalId: '3', name: 'Napa 500mg' }],
            [{ id: 'x', name: 'Napa' }],
            SOURCE,
        );
        expect(row.matchId).toBeNull();
    });

    it('matches measureless products to each other', () => {
        const [row] = buildProductCandidates([{ externalId: '4', name: 'Hand Sanitizer' }], existing, SOURCE);
        expect(row.matchId).toBe('p3');
    });

    it('emits exactly one row per source record', () => {
        const rows = buildProductCandidates(
            [
                { externalId: '1', name: 'Napa 500mg' },
                { externalId: '2', name: 'Napa 250mg' },
            ],
            existing,
            SOURCE,
        );
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.externalId)).toEqual(['1', '2']);
    });

    it('carries the measures through as sourceExtra', () => {
        const [row] = buildProductCandidates([{ externalId: '1', name: 'Napa 500mg 10s' }], existing, SOURCE);
        expect(row.sourceExtra).toBe('10s, 500mg');
    });

    it('tags every row with the source system', () => {
        const [row] = buildProductCandidates([{ externalId: '1', name: 'Napa 500mg' }], existing, SOURCE);
        expect(row.source).toBe(SOURCE);
        expect(row.entity).toBe('PRODUCT');
    });
});

describe('buildCustomerCandidates', () => {
    const existing: ExistingRecord[] = [
        { id: 'c1', name: 'Rahim Uddin', phone: '+8801712345678' },
        { id: 'c2', name: 'Karim Mia', phone: null },
    ];

    it('auto-accepts an exact phone match regardless of name', () => {
        const [row] = buildCustomerCandidates(
            [{ externalId: '1', name: 'R. Uddin', phone: '01712-345678' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBe('c1');
        expect(row.confidence).toBe('high');
        expect(row.decision).toBe('accept');
    });

    it('does not match on name when the phone differs', () => {
        const [row] = buildCustomerCandidates(
            [{ externalId: '2', name: 'Rahim Uddin', phone: '01999999999' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBeNull();
        expect(row.decision).toBe('new');
    });

    it('sends a phoneless source customer to review rather than matching on name', () => {
        const [row] = buildCustomerCandidates([{ externalId: '3', name: 'Karim Mia', phone: null }], existing, SOURCE);
        expect(row.confidence).toBe('medium');
        expect(row.decision).toBe('');
    });
});

describe('buildSupplierCandidates', () => {
    const existing: ExistingRecord[] = [{ id: 's1', name: 'Beximco Pharmaceuticals Limited' }];

    it('auto-accepts across corporate suffix drift', () => {
        const [row] = buildSupplierCandidates(
            [{ externalId: '1', name: 'Beximco Pharmaceuticals Ltd' }],
            existing,
            SOURCE,
        );
        expect(row.matchId).toBe('s1');
        expect(row.confidence).toBe('high');
    });

    it('sends a partial name to review', () => {
        const [row] = buildSupplierCandidates([{ externalId: '2', name: 'Beximco Healthcare' }], existing, SOURCE);
        expect(row.confidence).toBe('medium');
        expect(row.decision).toBe('');
    });

    it('proposes nothing for an unrelated supplier', () => {
        const [row] = buildSupplierCandidates([{ externalId: '3', name: 'ACI Limited' }], existing, SOURCE);
        expect(row.matchId).toBeNull();
        expect(row.decision).toBe('new');
    });

    it('offers at most three alternates', () => {
        const many: ExistingRecord[] = [
            { id: 'a', name: 'Beximco Pharma' },
            { id: 'b', name: 'Beximco Healthcare' },
            { id: 'c', name: 'Beximco Agro' },
            { id: 'd', name: 'Beximco Textiles' },
        ];
        const [row] = buildSupplierCandidates([{ externalId: '4', name: 'Beximco' }], many, SOURCE);
        expect(row.altIds.length).toBeLessThanOrEqual(3);
    });
});
