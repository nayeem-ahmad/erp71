import { buildAccountingSidebarChildren } from './accounting-nav';
import { enMessages } from './localization/messages/en/index';

describe('accounting-nav', () => {
    it('builds sidebar children with all accounting feature groups', () => {
        const children = buildAccountingSidebarChildren(enMessages);

        const labels = children.flatMap((child) => {
            if ('type' in child && child.type === 'subgroup') {
                return [child.label, ...child.children.map((link) => link.label)];
            }
            return [child.label];
        });

        expect(labels).toContain('Overview');
        expect(labels).toContain('Transactions & Funds');
        expect(labels).toContain('Reconciliation');
        expect(labels).toContain('Reports');
        expect(labels).toContain('Settings');
        expect(labels).toContain('Expense Categories');
        expect(labels).toContain('Bank Reconciliation');
        expect(labels).toContain('Fiscal Periods');
        expect(labels).toContain('Trial Balance');
    });
});