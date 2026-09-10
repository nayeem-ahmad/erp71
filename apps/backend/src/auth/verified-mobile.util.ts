import { ConflictException } from '@nestjs/common';
import { countryCodeFromE164, DEFAULT_MOBILE_COUNTRY_CODE } from '@erp71/shared-types';
import type { FirebasePhoneProfile } from './firebase-token.service';

/** The columns this helper reads off the account it is reconciling. */
export type VerifiedMobileTarget = {
    id: string;
    firebase_uid: string | null;
    mobile: string | null;
    mobile_verified_at: Date | null;
};

/** Just enough of `DatabaseService` to run the update, so tests can pass a stub. */
type UserWriter = {
    user: {
        findUnique: (args: any) => Promise<any>;
        update: (args: any) => Promise<any>;
    };
    $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

/**
 * Free up `mobile` for an account that has just proved it by SMS.
 *
 * Needed only because the column is unique. Firebase is the authority on which
 * number an identity holds, so a ported line or a new SIM can point at a number
 * another account merely typed into a form — and without this the sign-in would
 * die on a P2002 the user can do nothing about. A proved claim outranks a typed
 * one, so the number comes off the account that never confirmed it; that account
 * keeps its login, which was never the number, and can set a different one. This
 * is the same precedence `sync-user-mobile-unique.ts` applies to the duplicates
 * already in the data.
 *
 * Two accounts that have each *verified* the same number is a different matter:
 * nothing here can say which is current, and moving a verified number would hand
 * one person the other's way in. That refuses instead.
 */
export async function releaseMobileForVerifiedClaim(tx: any, mobile: string, claimantUserId: string) {
    const holder = await tx.user.findUnique({
        where: { mobile },
        select: { id: true, mobile_verified_at: true },
    });
    if (!holder || holder.id === claimantUserId) return;

    if (holder.mobile_verified_at) {
        throw new ConflictException(
            'This mobile number is already verified on another account. Please sign in with that account.',
        );
    }

    await tx.user.update({
        where: { id: holder.id },
        data: { mobile: null, mobile_verified_at: null },
    });
}

/**
 * Bring an existing account in line with a Firebase-verified phone identity:
 * adopt the uid, follow a number that has moved, and stamp the verification.
 *
 * Shared by the ERP sign-in (`AuthService.mobileSignIn`) and the storefront's
 * shopper sign-in so both apply the same precedence when a verified number has
 * to be taken off an account that only ever typed it — a rule that is only
 * safe while it is applied identically everywhere.
 */
export async function applyVerifiedMobileIdentity(
    db: UserWriter,
    user: VerifiedMobileTarget,
    profile: FirebasePhoneProfile,
): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (!user.firebase_uid) patch.firebase_uid = profile.firebaseUid;
    // Firebase is the authority on which number this identity holds now, so a
    // number changed there (new SIM, ported line) follows through to here.
    if (user.mobile !== profile.phoneNumber) {
        patch.mobile = profile.phoneNumber;
        patch.mobile_country_code = countryCodeFromE164(profile.phoneNumber) ?? DEFAULT_MOBILE_COUNTRY_CODE;
    }
    if (!user.mobile_verified_at || patch.mobile) patch.mobile_verified_at = new Date();

    if (patch.mobile) {
        // Taking the number off its previous holder and putting it on this
        // account has to be one step: a failure in between would leave the
        // number attached to nobody.
        await db.$transaction(async (tx: any) => {
            await releaseMobileForVerifiedClaim(tx, patch.mobile as string, user.id);
            await tx.user.update({ where: { id: user.id }, data: patch });
        });
        return;
    }

    if (Object.keys(patch).length > 0) {
        await db.user.update({ where: { id: user.id }, data: patch });
    }
}
