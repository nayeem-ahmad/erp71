import { warehouseLabel } from './warehouse-label';

const wh = (id: string, name: string, branch?: string) => ({
    id,
    name,
    store: branch === undefined ? null : { name: branch },
});

describe('warehouseLabel', () => {
    it('leaves a name alone when nothing else in the list shares it', () => {
        const list = [wh('a', 'Cold Store', 'Dhaka Branch'), wh('b', 'Main Godown', 'Dhaka Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Cold Store');
    });

    // The case the rule exists for: two branches may each hold a "Godown", and a
    // tenant-wide picker would otherwise show the same word twice.
    it('names the branch on each side of a shared name', () => {
        const list = [wh('a', 'Godown', 'Dhaka Branch'), wh('b', 'Godown', 'Chittagong Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Godown (Dhaka Branch)');
        expect(warehouseLabel(list[1], list)).toBe('Godown (Chittagong Branch)');
    });

    it('treats case and padding as the same name', () => {
        const list = [wh('a', 'Godown', 'Dhaka Branch'), wh('b', '  godown  ', 'Chittagong Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Godown (Dhaka Branch)');
        expect(warehouseLabel(list[1], list)).toBe('godown (Chittagong Branch)');
    });

    it('does not qualify a warehouse against itself', () => {
        const list = [wh('a', 'Godown', 'Dhaka Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Godown');
    });

    // A blank parenthesis reads worse than an ambiguous name, so an unknown
    // branch means the bare name.
    it('keeps the bare name when the branch is unknown', () => {
        const list = [wh('a', 'Godown'), wh('b', 'Godown', 'Chittagong Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Godown');
        expect(warehouseLabel(list[1], list)).toBe('Godown (Chittagong Branch)');
    });

    it('is scoped to the list it is given, not to the tenant', () => {
        const dhaka = wh('a', 'Godown', 'Dhaka Branch');
        const ctg = wh('b', 'Godown', 'Chittagong Branch');
        // Filtered to one branch, as the entry screens do — nothing to settle.
        expect(warehouseLabel(dhaka, [dhaka])).toBe('Godown');
        expect(warehouseLabel(dhaka, [dhaka, ctg])).toBe('Godown (Dhaka Branch)');
    });

    it('trims the name it returns', () => {
        const list = [wh('a', '  Cold Store  ', 'Dhaka Branch')];
        expect(warehouseLabel(list[0], list)).toBe('Cold Store');
    });
});
