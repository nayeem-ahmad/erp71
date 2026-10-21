import { resolveMobileToE164 } from '@erp71/shared-types';

/**
 * Bangladesh mobiles are `01` then `3`–`9` then eight digits.
 * `011` and `012` are not in service, and a landline cannot take an SMS.
 */
const BD_MOBILE_NATIONAL = /^1[3-9]\d{8}$/;

/**
 * A number an SMS can be delivered to, as E.164, or null.
 *
 * Customer phones are typed free-form (`017…`, `+880…`, a landline, a blank).
 * The credit is taken before the gateway answers, so a number that cannot
 * receive a text must never be handed to the send.
 */
export function smsDestination(raw: string | null | undefined): string | null {
    const e164 = resolveMobileToE164(raw);
    if (!e164) return null;
    if (e164.startsWith('+880')) {
        const national = e164.slice('+880'.length);
        if (!BD_MOBILE_NATIONAL.test(national)) return null;
    }
    return e164;
}
