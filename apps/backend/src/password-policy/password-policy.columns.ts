import {
    DEFAULT_PASSWORD_POLICY,
    normalizePasswordPolicy,
    type PasswordPolicy,
} from '@erp71/shared-types';

/**
 * The `Tenant` columns the policy lives in, and the two mappings between them
 * and the `PasswordPolicy` shape the evaluator and the API speak.
 *
 * Their own file so both the enforcement service and the settings service read
 * and write the policy through one definition — a second hand-written select
 * that forgot a column would silently hand back a default and quietly relax the
 * rule for every workspace that had tightened it.
 */
export const PASSWORD_POLICY_SELECT = {
    password_min_length: true,
    password_require_uppercase: true,
    password_require_lowercase: true,
    password_require_number: true,
    password_require_symbol: true,
    password_block_common: true,
} as const;

export interface PasswordPolicyColumns {
    password_min_length: number;
    password_require_uppercase: boolean;
    password_require_lowercase: boolean;
    password_require_number: boolean;
    password_require_symbol: boolean;
    password_block_common: boolean;
}

/** Normalizes on the way out, so a hand-edited row still evaluates in bounds. */
export function policyFromColumns(
    row: PasswordPolicyColumns | null | undefined,
): PasswordPolicy {
    if (!row) return { ...DEFAULT_PASSWORD_POLICY };
    return normalizePasswordPolicy({
        min_length: row.password_min_length,
        require_uppercase: row.password_require_uppercase,
        require_lowercase: row.password_require_lowercase,
        require_number: row.password_require_number,
        require_symbol: row.password_require_symbol,
        block_common: row.password_block_common,
    });
}

export function columnsFromPolicy(policy: PasswordPolicy): PasswordPolicyColumns {
    return {
        password_min_length: policy.min_length,
        password_require_uppercase: policy.require_uppercase,
        password_require_lowercase: policy.require_lowercase,
        password_require_number: policy.require_number,
        password_require_symbol: policy.require_symbol,
        password_block_common: policy.block_common,
    };
}
