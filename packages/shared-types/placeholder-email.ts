/**
 * Placeholder addresses for accounts that have no email.
 *
 * `User.email` is `NOT NULL` and globally unique, but the people employee login
 * exists for — a shop assistant in Mirpur, a delivery rider — routinely have a
 * phone and no email at all. `Employee.phone` is required and `Employee.email`
 * is optional, which is the same fact stated in the HR schema.
 *
 * So an employee provisioned without an address gets one of these. It is a
 * value in a `NOT NULL` column, nothing more: it is never sent to, never shown,
 * and never accepted at sign-in — those accounts authenticate by mobile number,
 * which `authenticateByMobile` has supported since before this existed.
 *
 * The domain is under `.invalid`, which RFC 2606 reserves precisely so that it
 * can never be registered or resolved. A typo'd real domain here would mean
 * password-reset mail for a shop's staff going to a stranger.
 */
const PLACEHOLDER_EMAIL_DOMAIN = 'employee.erp71.invalid';

/** The placeholder address for an employee-login account with no real email. */
export function placeholderEmailFor(employeeId: string): string {
    return `emp-${employeeId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * Whether an address is one of ours rather than something a person can be
 * reached at.
 *
 * Both ends need this and they need to agree: the backend to refuse to send
 * mail to it, the frontend to render "No email" instead of a machine address in
 * the member list and on the employee's own profile. Matching the whole domain
 * rather than the `emp-` prefix means a future portal minting placeholders on
 * the same domain is covered without touching the readers.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
    return typeof email === 'string' && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** The address to display, or null when there is nothing worth showing. */
export function displayEmail(email: string | null | undefined): string | null {
    if (!email || isPlaceholderEmail(email)) return null;
    return email;
}
