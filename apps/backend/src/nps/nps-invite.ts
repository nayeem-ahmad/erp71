import { randomBytes } from 'crypto';
import type { DatabaseService } from '../database/database.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * An 8-character survey code from an alphabet without look-alikes (0/O, 1/l).
 * 56^8 is about 10^14, so codes cannot be guessed, and the link stays short
 * enough to fit in the receipt SMS.
 */
export function newSurveyCode(length = 8): string {
    const bytes = randomBytes(length);
    let code = '';
    for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
    return code;
}

/** Where a survey code is answered: `<FRONTEND_URL>/f/<code>`. */
export function surveyUrl(code: string): string {
    const base = (process.env.FRONTEND_URL ?? 'https://app.erp71.com').replace(/\/+$/, '');
    return `${base}/f/${code}`;
}

/**
 * The survey link for a sale's receipt, or null when the shop has not turned
 * the survey on (Sales Settings). A standalone function over the database
 * rather than a service, so the sale path can call it without another
 * injected dependency. Never throws: a survey must not cost a receipt.
 */
export async function createSaleSurveyLink(
    db: DatabaseService,
    sale: { tenantId: string; saleId: string; customerId: string; storeId: string | null },
): Promise<string | null> {
    try {
        const settings = await db.salesSettings.findUnique({
            where: { tenant_id: sale.tenantId },
            select: { nps_survey_enabled: true },
        });
        if (!settings?.nps_survey_enabled) return null;

        const invite = await db.npsInvite.create({
            data: {
                code: newSurveyCode(),
                tenant_id: sale.tenantId,
                store_id: sale.storeId,
                sale_id: sale.saleId,
                customer_id: sale.customerId,
            },
        });
        return surveyUrl(invite.code);
    } catch {
        return null;
    }
}
