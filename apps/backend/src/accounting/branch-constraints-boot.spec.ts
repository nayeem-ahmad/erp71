import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRANCH_BOOK_CONSTRAINT_SQL } from '@erp71/database/prisma/branch-book-constraints';

const repoRoot = resolve(__dirname, '../../../..');

describe('branch-drawer constraints on boot', () => {
    const prepare = readFileSync(resolve(repoRoot, 'apps/backend/scripts/db-prepare.sh'), 'utf8');
    const installer = readFileSync(
        resolve(repoRoot, 'packages/database/prisma/sync-branch-constraints.ts'),
        'utf8',
    );

    it('reinstalls the indexes after db push and does not fold the books', () => {
        const pushAt = prepare.indexOf('prisma db push');
        const constraintsAt = prepare.indexOf('sync:branch-constraints');
        expect(pushAt).toBeGreaterThan(-1);
        expect(constraintsAt).toBeGreaterThan(pushAt);
        expect(prepare).not.toMatch(/npm run sync:branch-books/);
        expect(installer).not.toContain('planBranchBooks');
        expect(installer).not.toContain("argv.includes('--yes')");
    });

    it('covers the shared-name unique, one drawer per branch, and the cash-only check', () => {
        const sql = BRANCH_BOOK_CONSTRAINT_SQL.join('\n');
        expect(sql).toContain('accounts_shared_name_key');
        expect(sql).toContain('accounts_one_drawer_per_branch');
        expect(sql).toContain('accounts_store_id_cash_only');
    });
});
