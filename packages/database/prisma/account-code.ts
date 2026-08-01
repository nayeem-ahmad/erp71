/**
 * Hierarchical chart-of-accounts codes.
 *
 *   1 1   01    02
 *   │ │    │     └── account serial within the subgroup
 *   │ │    └──────── subgroup serial within the group  (00 = no subgroup)
 *   │ └───────────── group serial within the type
 *   └─────────────── type class (1 asset … 5 expense)
 *
 * A subgroup code always starts with its group's code, and an account code
 * always starts with its subgroup's code, so `code LIKE '1101%'` is an exact
 * subtree filter and a plain lexicographic sort is hierarchy order.
 *
 * Segments are FIXED WIDTH, which is what makes that sort work. Serials
 * therefore run out — 9 groups per type, 99 children elsewhere. Rather than
 * widening the field (which only moves the wall), an exhausted serial spills
 * into base-36 at the SAME width: … 97, 98, 99, A0, A1 … ZZ. That is ordered
 * correctly for free, because '9' (0x39) sorts before 'A' (0x41). Allocation
 * stays decimal-first, so a normal tenant never sees a letter.
 */
import { AccountType } from './accounting.constants.js';

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GROUP_CODE_LENGTH = 2;
export const SUBGROUP_CODE_LENGTH = 4;
export const ACCOUNT_CODE_LENGTH = 6;

/** Width of the serial each level appends to its parent's code. */
export const GROUP_SERIAL_WIDTH = 1;
export const SUBGROUP_SERIAL_WIDTH = 2;
export const ACCOUNT_SERIAL_WIDTH = 2;

/**
 * Subgroup slot for accounts hanging directly off a group (`subgroup_id` is
 * nullable). Reserved, never allocated, so every account code is 6 chars wide.
 */
export const NO_SUBGROUP_SLOT = '00';

/**
 * Leading digit per account type. Only 1–5 of a possible 1–Z are spoken for,
 * leaving room if `AccountType` ever grows.
 */
export const ACCOUNT_TYPE_CODE_DIGIT: Record<string, string> = {
    [AccountType.ASSET]: '1',
    [AccountType.LIABILITY]: '2',
    [AccountType.EQUITY]: '3',
    [AccountType.REVENUE]: '4',
    [AccountType.EXPENSE]: '5',
};

export type AccountCodeSerialWidth = 1 | 2;

/** Highest serial still expressible in decimal at this width. */
export function decimalSerialMax(width: AccountCodeSerialWidth): number {
    return width === 1 ? 9 : 99;
}

/** Highest serial expressible at all at this width, alpha spill included. */
export function maxSerial(width: AccountCodeSerialWidth): number {
    // width 1: 9 decimal + 26 (A–Z).  width 2: 99 decimal + 26*36 (A0–ZZ).
    return width === 1 ? 35 : 1035;
}

export class AccountCodeExhaustedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AccountCodeExhaustedError';
    }
}

/**
 * Encode a 1-based serial. Decimal while it fits, then base-36 at the same
 * width, so encoded order always matches numeric order.
 */
export function encodeSerial(serial: number, width: AccountCodeSerialWidth): string {
    if (!Number.isInteger(serial) || serial < 1) {
        throw new RangeError(`Account code serial must be a positive integer, got ${serial}.`);
    }

    const decimalMax = decimalSerialMax(width);
    if (serial <= decimalMax) {
        return String(serial).padStart(width, '0');
    }

    if (serial > maxSerial(width)) {
        throw new AccountCodeExhaustedError(
            `Serial ${serial} does not fit in ${width} character(s).`,
        );
    }

    // 0-based index into the alpha phase, whose first character is always A–Z.
    const offset = serial - decimalMax - 1;
    if (width === 1) {
        return B36[10 + offset];
    }
    return B36[10 + Math.floor(offset / 36)] + B36[offset % 36];
}

/** Inverse of {@link encodeSerial}. Returns null when `text` is not a serial. */
export function decodeSerial(text: string, width: AccountCodeSerialWidth): number | null {
    if (typeof text !== 'string' || text.length !== width) {
        return null;
    }

    if (/^\d+$/.test(text)) {
        const value = Number(text);
        return value >= 1 && value <= decimalSerialMax(text.length as AccountCodeSerialWidth)
            ? value
            : null;
    }

    const head = B36.indexOf(text[0]);
    // The alpha phase always opens with a letter; '0A' and friends are not codes
    // this scheme ever emits, so they are rejected rather than quietly accepted.
    if (head < 10) {
        return null;
    }

    if (width === 1) {
        return decimalSerialMax(1) + 1 + (head - 10);
    }

    const tail = B36.indexOf(text[1]);
    if (tail < 0) {
        return null;
    }
    return decimalSerialMax(2) + 1 + (head - 10) * 36 + tail;
}

/**
 * Next free serial among `siblings`.
 *
 * Monotonic (`max + 1`) by default so a deleted account's code is never
 * recycled onto a different account — last year's printed ledger keeps meaning
 * what it said. Only once the decimal phase is full does it backfill holes, and
 * only once those are gone does it spill into letters. That ordering means a
 * hand-picked high code (say `…90`) costs a few wasted slots rather than
 * pushing every later account into the alpha phase.
 */
export function nextSerial(siblings: Iterable<number>, width: AccountCodeSerialWidth): number {
    const used = new Set<number>();
    let highest = 0;
    for (const serial of siblings) {
        used.add(serial);
        if (serial > highest) {
            highest = serial;
        }
    }

    const decimalMax = decimalSerialMax(width);
    if (highest + 1 <= decimalMax) {
        return highest + 1;
    }

    for (let candidate = 1; candidate <= decimalMax; candidate += 1) {
        if (!used.has(candidate)) {
            return candidate;
        }
    }

    const limit = maxSerial(width);
    for (let candidate = decimalMax + 1; candidate <= limit; candidate += 1) {
        if (!used.has(candidate)) {
            return candidate;
        }
    }

    throw new AccountCodeExhaustedError(
        `All ${limit} code slots under this parent are taken. Split it into smaller groups.`,
    );
}

/**
 * Serials already used by `codes` directly under `parentCode`, ignoring
 * anything malformed or belonging elsewhere.
 */
export function usedSerialsUnder(
    parentCode: string,
    codes: Iterable<string>,
    width: AccountCodeSerialWidth,
): number[] {
    const serials: number[] = [];
    for (const code of codes) {
        if (typeof code !== 'string' || !code.startsWith(parentCode)) {
            continue;
        }
        const suffix = code.slice(parentCode.length);
        const serial = decodeSerial(suffix, width);
        if (serial !== null) {
            serials.push(serial);
        }
    }
    return serials;
}

/** Allocate the next child code under `parentCode`. */
export function nextChildCode(
    parentCode: string,
    siblingCodes: Iterable<string>,
    width: AccountCodeSerialWidth,
): string {
    const serials = usedSerialsUnder(parentCode, siblingCodes, width);
    return parentCode + encodeSerial(nextSerial(serials, width), width);
}

/** First free group code for `type` given the tenant's existing group codes. */
export function nextGroupCode(type: string, existingCodes: Iterable<string>): string {
    const digit = ACCOUNT_TYPE_CODE_DIGIT[type];
    if (!digit) {
        throw new RangeError(`Unknown account type "${type}".`);
    }
    return nextChildCode(digit, existingCodes, GROUP_SERIAL_WIDTH);
}

export function nextSubgroupCode(groupCode: string, existingCodes: Iterable<string>): string {
    return nextChildCode(groupCode, existingCodes, SUBGROUP_SERIAL_WIDTH);
}

/**
 * `subgroupCode` is null for an account parked directly under its group, which
 * allocates inside the reserved `00` slot.
 */
export function nextAccountCode(
    groupCode: string,
    subgroupCode: string | null | undefined,
    existingCodes: Iterable<string>,
): string {
    const parent = subgroupCode ?? groupCode + NO_SUBGROUP_SLOT;
    return nextChildCode(parent, existingCodes, ACCOUNT_SERIAL_WIDTH);
}

/** The 4-character prefix every account under this parent must carry. */
export function accountCodePrefix(
    groupCode: string,
    subgroupCode: string | null | undefined,
): string {
    return subgroupCode ?? groupCode + NO_SUBGROUP_SLOT;
}

export type AccountCodeLevel = 'group' | 'subgroup' | 'account';

const LEVEL_LENGTH: Record<AccountCodeLevel, number> = {
    group: GROUP_CODE_LENGTH,
    subgroup: SUBGROUP_CODE_LENGTH,
    account: ACCOUNT_CODE_LENGTH,
};

const LEVEL_SERIAL_WIDTH: Record<AccountCodeLevel, AccountCodeSerialWidth> = {
    group: GROUP_SERIAL_WIDTH,
    subgroup: SUBGROUP_SERIAL_WIDTH,
    account: ACCOUNT_SERIAL_WIDTH,
};

/**
 * Uppercase and trim a user-supplied code. Lowercase letters sort AFTER
 * uppercase in ASCII, so an un-normalised `1101a0` would look right and sort to
 * the wrong place.
 */
export function normalizeAccountCode(code: string): string {
    return code.trim().toUpperCase();
}

/**
 * Validate a code against its level and parent.
 *
 * @returns null when valid, otherwise a message fit to show the user.
 */
export function validateAccountCode(
    code: string,
    level: AccountCodeLevel,
    parentCode: string | null,
): string | null {
    const expectedLength = LEVEL_LENGTH[level];
    if (code.length !== expectedLength) {
        return `A ${level} code must be exactly ${expectedLength} characters.`;
    }

    if (!/^[0-9A-Z]+$/.test(code)) {
        return 'A code may only contain digits and capital letters A–Z.';
    }

    if (parentCode !== null && !code.startsWith(parentCode)) {
        // A group has no parent row; its "parent" is the type class, and the
        // leading digit is what makes an account's type readable off its code.
        return level === 'group'
            ? `A group code must start with the digit for its account type (${parentCode}).`
            : `This code must start with its parent's code (${parentCode}).`;
    }

    const width = LEVEL_SERIAL_WIDTH[level];
    const serial = decodeSerial(code.slice(expectedLength - width), width);
    if (serial === null) {
        return `The last ${width} character(s) must be a serial from ${encodeSerial(1, width)} to ${encodeSerial(maxSerial(width), width)}.`;
    }

    return null;
}

/** Split an account code into its segments. Returns null if malformed. */
export function parseAccountCode(code: string): {
    typeDigit: string;
    groupCode: string;
    subgroupSlot: string;
    subgroupCode: string;
    accountSerial: string;
    hasSubgroup: boolean;
} | null {
    if (typeof code !== 'string' || code.length !== ACCOUNT_CODE_LENGTH) {
        return null;
    }
    const groupCode = code.slice(0, GROUP_CODE_LENGTH);
    const subgroupSlot = code.slice(GROUP_CODE_LENGTH, SUBGROUP_CODE_LENGTH);
    return {
        typeDigit: code[0],
        groupCode,
        subgroupSlot,
        subgroupCode: code.slice(0, SUBGROUP_CODE_LENGTH),
        accountSerial: code.slice(SUBGROUP_CODE_LENGTH),
        hasSubgroup: subgroupSlot !== NO_SUBGROUP_SLOT,
    };
}

/** `110101` → `11-01-01`, for display only. Codes are stored unformatted. */
export function formatAccountCode(code: string): string {
    if (typeof code !== 'string' || code.length !== ACCOUNT_CODE_LENGTH) {
        return code;
    }
    return `${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4)}`;
}
