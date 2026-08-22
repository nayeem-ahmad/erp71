import {
    CAPITALIZED_BY_DEFAULT,
    DEFAULT_BASIS_BY_COST_TYPE,
    IMPORT_COST_TYPES,
    ShipmentStatus,
    canTransition,
} from './imports.constants';

describe('canTransition', () => {
    it('allows forward movement along the flow', () => {
        expect(canTransition(ShipmentStatus.DRAFT, ShipmentStatus.LC_APPLIED)).toBe(true);
        expect(canTransition(ShipmentStatus.SHIPPED, ShipmentStatus.DOCS_RECEIVED)).toBe(true);
    });

    it('allows skipping states a business does not have', () => {
        // An air shipment paid by telegraphic transfer never opens an LC, and
        // forcing a click through states that do not apply is how a status
        // field stops meaning anything.
        expect(canTransition(ShipmentStatus.DRAFT, ShipmentStatus.SHIPPED)).toBe(true);
        expect(canTransition(ShipmentStatus.LC_APPLIED, ShipmentStatus.CUSTOMS)).toBe(true);
    });

    it('refuses going backwards', () => {
        // Costs and postings attach to states; reopening a received shipment
        // would leave a Purchase whose stock is already on the shelf.
        expect(canTransition(ShipmentStatus.CUSTOMS, ShipmentStatus.SHIPPED)).toBe(false);
        expect(canTransition(ShipmentStatus.RECEIVED, ShipmentStatus.CUSTOMS)).toBe(false);
    });

    it('treats a no-op as allowed', () => {
        expect(canTransition(ShipmentStatus.SHIPPED, ShipmentStatus.SHIPPED)).toBe(true);
    });

    it('allows cancelling anything not yet received', () => {
        expect(canTransition(ShipmentStatus.DRAFT, ShipmentStatus.CANCELLED)).toBe(true);
        expect(canTransition(ShipmentStatus.CUSTOMS, ShipmentStatus.CANCELLED)).toBe(true);
    });

    it('refuses cancelling once the goods exist', () => {
        // After receipt the answer is a purchase return, not a cancellation.
        expect(canTransition(ShipmentStatus.RECEIVED, ShipmentStatus.CANCELLED)).toBe(false);
        expect(canTransition(ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED)).toBe(false);
    });

    it('refuses reviving a cancelled shipment', () => {
        expect(canTransition(ShipmentStatus.CANCELLED, ShipmentStatus.SHIPPED)).toBe(false);
        expect(canTransition(ShipmentStatus.CANCELLED, ShipmentStatus.CANCELLED)).toBe(true);
    });

    it('refuses a status that is not part of the flow', () => {
        expect(canTransition(ShipmentStatus.DRAFT, 'NONSENSE')).toBe(false);
        expect(canTransition('NONSENSE', ShipmentStatus.DRAFT)).toBe(false);
    });
});

describe('cost type tables', () => {
    it('covers every cost type', () => {
        // A cost type missing from either table reads as `undefined` at
        // runtime: undefined is falsy, so a duty line would silently stop being
        // capitalised.
        for (const costType of IMPORT_COST_TYPES) {
            expect(CAPITALIZED_BY_DEFAULT).toHaveProperty(costType);
            expect(DEFAULT_BASIS_BY_COST_TYPE).toHaveProperty(costType);
            expect(typeof CAPITALIZED_BY_DEFAULT[costType]).toBe('boolean');
        }
    });

    it('does not capitalise what the tenant gets back', () => {
        // Rebatable VAT and creditable AIT are receivables. Capitalising them
        // overstates COGS on every subsequent sale of the goods.
        expect(CAPITALIZED_BY_DEFAULT.VAT).toBe(false);
        expect(CAPITALIZED_BY_DEFAULT.AIT).toBe(false);
    });

    it('does not capitalise financing', () => {
        // LC margin is the tenant's own cash at the bank, not a cost at all.
        // Commission and bank charges are the cost of financing the import, so
        // capitalising them makes a slow shipment look like a dear product.
        expect(CAPITALIZED_BY_DEFAULT.LC_MARGIN).toBe(false);
        expect(CAPITALIZED_BY_DEFAULT.LC_COMMISSION).toBe(false);
        expect(CAPITALIZED_BY_DEFAULT.BANK_CHARGE).toBe(false);
    });

    it('capitalises what genuinely landed the goods', () => {
        for (const costType of ['FREIGHT', 'INSURANCE', 'CUSTOMS_DUTY', 'RD', 'SD', 'CF_AGENT', 'PORT', 'TRANSPORT'] as const) {
            expect(CAPITALIZED_BY_DEFAULT[costType]).toBe(true);
        }
    });

    it('allocates freight on weight, not value', () => {
        // Freight is billed on kilos. On value it would land on the expensive
        // line rather than the heavy one.
        expect(DEFAULT_BASIS_BY_COST_TYPE.FREIGHT).toBe('WEIGHT');
        expect(DEFAULT_BASIS_BY_COST_TYPE.TRANSPORT).toBe('WEIGHT');
        expect(DEFAULT_BASIS_BY_COST_TYPE.CUSTOMS_DUTY).toBe('VALUE');
    });
});
