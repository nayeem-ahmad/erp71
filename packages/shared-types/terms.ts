/**
 * Version of the Terms of Service that a signup is agreeing to.
 *
 * Consent has to name *what* was consented to or it proves nothing, so this
 * string is sent by the signup form, validated by the backend and stored on
 * every `TermsAcceptance` row. Bump it — and only bump it — when the terms
 * change in a way people should be asked about again. A bump does not
 * retroactively invalidate anyone: existing rows keep naming the version those
 * people actually saw, which is the whole point of recording it.
 *
 * Date-shaped rather than semver because that is what the document itself is
 * dated by, and a reader comparing a stored row against the published page
 * should not have to map one numbering onto another.
 */
export const CURRENT_TERMS_VERSION = '2026-09-07';

/**
 * Which flow collected the consent. Recorded because the three signup paths
 * present the checkbox differently, and "which screen was this person looking
 * at" is the first question asked of any consent record that is challenged.
 */
export const TERMS_ACCEPTANCE_SOURCES = [
  'SIGNUP',
  'GOOGLE_SIGNUP',
  'MOBILE_SIGNUP',
] as const;

export type TermsAcceptanceSource = (typeof TERMS_ACCEPTANCE_SOURCES)[number];

export function isCurrentTermsVersion(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === CURRENT_TERMS_VERSION;
}
