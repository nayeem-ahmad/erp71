import { BadRequestException, Injectable } from '@nestjs/common';
import {
    DEFAULT_PASSWORD_POLICY,
    describePasswordPolicy,
    evaluatePassword,
    strictestPasswordPolicy,
    type PasswordPolicy,
} from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { PASSWORD_POLICY_SELECT, policyFromColumns } from './password-policy.columns';

/**
 * Resolves the password policy that applies to a given password change, and
 * enforces it.
 *
 * Every path that writes a `passwordHash` for a workspace member goes through
 * `assertValid*` here — change password, reset by emailed link, and claiming an
 * invitation — so a workspace admin who tightens the rule tightens all three at
 * once. The DTOs keep their own `@MinLength(8)`: that is the platform floor and
 * it rejects the obvious case before a database round trip, while this service
 * applies whatever the workspace asked for on top.
 */
@Injectable()
export class PasswordPolicyService {
    constructor(private readonly db: DatabaseService) {}

    /** The policy a single workspace has configured. */
    async getForTenant(tenantId: string): Promise<PasswordPolicy> {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: PASSWORD_POLICY_SELECT,
        });
        return policyFromColumns(tenant);
    }

    /**
     * The policy that applies to one person's password.
     *
     * Somebody can be a member of several workspaces and has one password for
     * all of them, so the answer is the strictest of theirs rather than any one
     * workspace's — see `strictestPasswordPolicy`. Someone in no workspace at
     * all (a storefront shopper, a job applicant, an owner mid-signup) gets the
     * platform default.
     */
    async getForUser(userId: string): Promise<PasswordPolicy> {
        const memberships = await this.db.tenantUser.findMany({
            where: { user_id: userId, tenant: { deleted_at: null } },
            select: { tenant: { select: PASSWORD_POLICY_SELECT } },
        });

        if (memberships.length === 0) return { ...DEFAULT_PASSWORD_POLICY };
        return strictestPasswordPolicy(memberships.map((m) => policyFromColumns(m.tenant)));
    }

    /**
     * Throw unless the candidate satisfies the policy.
     *
     * The message is the whole policy, not the first rule that failed: someone
     * pasting from a password manager should not have to resubmit four times to
     * discover four rules. The frontend renders its own localized checklist from
     * the same evaluator, so this text is what an API client sees.
     */
    assertValid(password: string, policy: PasswordPolicy): void {
        if (evaluatePassword(password, policy).valid) return;
        throw new BadRequestException(describePasswordPolicy(policy));
    }

    async assertValidForTenant(password: string, tenantId: string): Promise<void> {
        this.assertValid(password, await this.getForTenant(tenantId));
    }

    async assertValidForUser(password: string, userId: string): Promise<void> {
        this.assertValid(password, await this.getForUser(userId));
    }
}
