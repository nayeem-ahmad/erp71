import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `EmployeeLoginService` writes a `TenantUser` with no roles at all. The column
 * is `NOT NULL DEFAULT 'CASHIER'`, so every portal-only member carries
 * `role = 'CASHIER'` whether anyone meant it or not.
 *
 * That is inert **only** while no route accepts that role. `TenantRoleGuard` is
 * its sole reader, and it grants on a bare `requiredRoles.includes(membership.role)`
 * — so the day somebody writes `@TenantRoles('CASHIER')` on a controller, every
 * employee in every workspace on the platform can reach it. Nothing else in the
 * codebase would notice: the store-permission invariant the rest of the portal's
 * security rests on does not apply to that guard.
 *
 * Hence a test that reads the source rather than exercising a handler. The fix
 * if it ever goes red is not to amend this file: it is to give the portal
 * membership a role of its own that grants nothing, and to write the migration
 * that backfills existing rows.
 */
describe('the portal membership role grants nothing', () => {
    const SRC = join(__dirname, '..');

    function* walk(dir: string): Generator<string> {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                yield* walk(full);
            } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
                yield full;
            }
        }
    }

    it('no route is gated on CASHIER, which is what a portal membership defaults to', () => {
        const offenders: string[] = [];

        for (const file of walk(SRC)) {
            const source = readFileSync(file, 'utf8');
            // `@TenantRoles('OWNER', 'CASHIER')` and any spacing or quote style.
            for (const match of source.matchAll(/@TenantRoles\(([^)]*)\)/g)) {
                if (/['"]CASHIER['"]/.test(match[1])) {
                    offenders.push(`${file.slice(SRC.length + 1)}: ${match[0]}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
