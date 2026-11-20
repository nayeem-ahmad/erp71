import { DEFAULT_MOBILE_COUNTRY_CODE, isPlaceholderEmail, resolveMobileToE164 } from '@erp71/shared-types';

/**
 * Why a login and an employee card look like the same person.
 *
 * `mobile` and `email` are **strong**: `Employee.phone` is unique per workspace
 * and `User.mobile` / `User.email` are unique across the platform, so a match
 * on either names one person on each side. `name` is **weak** — two Karims are
 * ordinary — and is shown as a hint, never acted on: bulk matching ignores it.
 */
export type LinkMatchReason = 'mobile' | 'email' | 'name';

export const STRONG_MATCHES: readonly LinkMatchReason[] = ['mobile', 'email'];

export interface MatchableEmployee {
    phone: string | null;
    email: string | null;
    name: string;
}

export interface MatchableUser {
    mobile: string | null;
    email: string | null;
    name: string | null;
}

/** Lowercased with whitespace collapsed, so "Karim  Uddin" meets "karim uddin". */
function normalizeName(value: string | null | undefined): string {
    return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A real address, lowercased; null for none or one of our placeholders. */
function normalizeEmail(value: string | null | undefined): string | null {
    const email = (value ?? '').trim().toLowerCase();
    if (!email || isPlaceholderEmail(email)) return null;
    return email;
}

/**
 * Every reason `user` looks like `employee`, strongest first.
 *
 * `Employee.phone` is free text (imports and the add form accept `01700100057`)
 * while `User.mobile` is stored in E.164, so the phone is normalised the way
 * `EmployeeLoginService` does before a login is minted from it.
 */
export function linkMatchReasons(employee: MatchableEmployee, user: MatchableUser): LinkMatchReason[] {
    const reasons: LinkMatchReason[] = [];

    const phone = resolveMobileToE164(employee.phone, DEFAULT_MOBILE_COUNTRY_CODE);
    if (phone && user.mobile && phone === user.mobile) reasons.push('mobile');

    const employeeEmail = normalizeEmail(employee.email);
    if (employeeEmail && employeeEmail === normalizeEmail(user.email)) reasons.push('email');

    const name = normalizeName(employee.name);
    if (name && name === normalizeName(user.name)) reasons.push('name');

    return reasons;
}

export function isStrongMatch(reasons: readonly LinkMatchReason[]): boolean {
    return reasons.some((reason) => STRONG_MATCHES.includes(reason));
}

/** Candidates in the order a picker should offer them: strong, then name-only, then the rest. */
export function rankByMatch<T extends { matches: LinkMatchReason[]; label: string }>(rows: T[]): T[] {
    const weight = (row: T) => (isStrongMatch(row.matches) ? 0 : row.matches.length > 0 ? 1 : 2);
    return [...rows].sort((a, b) => weight(a) - weight(b) || a.label.localeCompare(b.label));
}

/**
 * The pairs bulk matching may offer: one employee, one login, a strong match,
 * and **neither side strongly matching anyone else**. An ambiguous pair — a
 * shared family number, two cards with the same email — is left for a person
 * to resolve on the employee page, not guessed at here.
 */
export function unambiguousPairs<E extends { id: string }, U extends { id: string }>(
    employees: readonly E[],
    users: readonly U[],
    reasonsFor: (employee: E, user: U) => LinkMatchReason[],
): Array<{ employee: E; user: U; matches: LinkMatchReason[] }> {
    const strong = new Map<string, Array<{ user: U; matches: LinkMatchReason[] }>>();
    const perUser = new Map<string, number>();

    for (const employee of employees) {
        for (const user of users) {
            const matches = reasonsFor(employee, user);
            if (!isStrongMatch(matches)) continue;
            const list = strong.get(employee.id) ?? [];
            list.push({ user, matches });
            strong.set(employee.id, list);
            perUser.set(user.id, (perUser.get(user.id) ?? 0) + 1);
        }
    }

    const pairs: Array<{ employee: E; user: U; matches: LinkMatchReason[] }> = [];
    for (const employee of employees) {
        const list = strong.get(employee.id);
        if (!list || list.length !== 1) continue;
        const [{ user, matches }] = list;
        if (perUser.get(user.id) !== 1) continue;
        pairs.push({ employee, user, matches });
    }
    return pairs;
}
