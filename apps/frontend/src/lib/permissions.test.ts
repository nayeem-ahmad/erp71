import { readsOwnHoursOnly, readsOwnRecordsOnly } from './permissions';

describe('record-scope helpers', () => {
    const member = (record_scope: string | null, role: string | null = 'CASHIER') => ({ role, record_scope });

    it('reads own tasks only under OWN, and no other scope', () => {
        expect(readsOwnRecordsOnly(member('OWN'))).toBe(true);
        // Member projects open every task of a project, so the assignee filter stays useful.
        expect(readsOwnRecordsOnly(member('PROJECT'))).toBe(false);
        expect(readsOwnRecordsOnly(member('ALL'))).toBe(false);
    });

    it('keeps hours personal under both narrowed scopes', () => {
        expect(readsOwnHoursOnly(member('OWN'))).toBe(true);
        expect(readsOwnHoursOnly(member('PROJECT'))).toBe(true);
        expect(readsOwnHoursOnly(member('ALL'))).toBe(false);
        expect(readsOwnHoursOnly(member(null))).toBe(false);
    });

    it('never narrows a workspace owner, or a missing tenant', () => {
        expect(readsOwnHoursOnly(member('PROJECT', 'OWNER'))).toBe(false);
        expect(readsOwnRecordsOnly(member('OWN', 'OWNER'))).toBe(false);
        expect(readsOwnHoursOnly(undefined)).toBe(false);
    });
});
