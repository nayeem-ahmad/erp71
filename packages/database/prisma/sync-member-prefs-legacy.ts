/**
 * One-shot: marks every existing member as still reading their old browser
 * values for table views, table columns and the sidebar, and fills out every
 * stored invoice print layout.
 *
 * Why this exists
 * ---------------
 * Default preference profiles let an owner set a starting point for new staff.
 * A profile must reach a member who joins after release but must not overwrite a
 * member who already set things up in their browser (those values live in
 * localStorage, which the server cannot see). `TenantUser.legacy_browser_sections`
 * names the sections whose browser values still count for that member; every
 * member existing today gets all three. A member who joins later starts with
 * none, so the profile applies to them.
 *
 * The same run rewrites each non-null `invoice_print_prefs` through
 * `normalizeInvoicePrintPrefs`. A layout saved before 2026-10-15 lacks
 * `signature_space_mm`, `table_borders` and `warranty_column`, and the profile
 * merge reads a missing key as "not answered yet". Filled out, the blob answers
 * every key, so a profile that sets one cannot change a layout the member
 * never touched.
 *
 * Runs AFTER `db push` (the columns must exist). The migration SQL creates the
 * schema only; this script does all the data work, in every environment, so a
 * dev database gets the invoice fill-out too. Local and dev databases do not run
 * db-prepare.sh: run it by hand with
 *   npm run sync:member-prefs-legacy --workspace=@erp71/database
 *
 * Runs once per database. Re-running would hand a member back to their old
 * browser values after they had moved on, and a member who joined after release
 * would be given leftovers. The first successful live run stores a marker
 * (`platform_settings`, group `sync`, key `member_prefs_legacy`) in the same
 * transaction as the work; later runs log it and exit 0.
 *
 * Usage:
 *   npx tsx prisma/sync-member-prefs-legacy.ts --dry-run
 *   npx tsx prisma/sync-member-prefs-legacy.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { runMemberPrefsLegacySync } from './sync-member-prefs-legacy.utils';

const prisma = new PrismaClient();

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const result = await runMemberPrefsLegacySync(prisma, { dryRun });

    if (result.skipped) {
        console.log('Sync member prefs legacy: already ran. Skipping.');
        return;
    }

    console.log(
        `Sync member prefs legacy (${dryRun ? 'DRY RUN' : 'LIVE'}) — ` +
            `${dryRun ? 'would mark' : 'marked'} ${result.members} member(s), ` +
            `${dryRun ? 'would fill out' : 'filled out'} ${result.blobs} invoice layout(s).`,
    );
    if (!dryRun) console.log('Recorded the run; later deploys skip this step.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
