/**
 * Telling "never activated" apart from "activated, then fell behind".
 *
 * Both sit at `PAST_DUE`. A workspace is provisioned there at signup with a
 * zero-length period and nothing charged; a paying tenant lands there when a fee
 * goes unsettled. The status is the same and the handling is opposite — one has
 * never been a customer and needs to be told how to become one, the other is in
 * dunning and gets reminders and eventually a suspension. `activated_at` is the
 * discriminator: stamped once, the first time a subscription reaches ACTIVE, and
 * never cleared.
 */

/** The error code a pending-activation refusal carries, for the frontend to route on. */
export const PENDING_ACTIVATION_CODE = 'PENDING_ACTIVATION';

export type ActivationStateInput = {
    status?: string | null;
    activated_at?: Date | null;
} | null | undefined;

/**
 * True when this workspace has never been paid for and switched on.
 *
 * A missing subscription row counts as pending: a tenant with no subscription at
 * all is certainly not an activated customer, and answering "yes, pending" sends
 * its owner to the activation screen rather than a bare permission error.
 *
 * A subscription that is currently ACTIVE or TRIALING is never pending, whatever
 * `activated_at` says — an admin can set the status by hand, and the live status
 * is the more authoritative of the two.
 */
export function isPendingActivation(subscription: ActivationStateInput): boolean {
    if (!subscription) return true;
    if (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') return false;
    return !subscription.activated_at;
}
