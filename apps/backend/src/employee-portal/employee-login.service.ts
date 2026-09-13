import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
    DEFAULT_MOBILE_COUNTRY_CODE,
    countryCodeFromE164,
    placeholderEmailFor,
    resolveMobileToE164,
} from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { PasswordPolicyService } from '../password-policy/password-policy.service';
import { generatePassword } from '../password-policy/generate-password';

/**
 * Giving an employee a way to sign in.
 *
 * **Why this is not the Team invite flow.** Until this existed, the only way to
 * get an employee into the portal was to invite them from Team & Permissions,
 * wait for them to accept an emailed link, then link the resulting user to the
 * employee record and grant portal access. That fails the people the portal is
 * for in three separate ways: they usually have no email address; the invite
 * assigns a tenant role, and a role carries store permissions — which is the
 * one thing that must not happen here; and a member holding permissions is a
 * billable seat, so a 40-person shop would pay for 30 seats to hand out
 * payslips.
 *
 * **The invariant.** `EmployeeGuard` and `employee-portal.security.spec.ts` both
 * say it: an employee-portal user *is* an ordinary tenant member with a real
 * `TenantUser` row, so `active_context === 'employee'` is a UI switch a client
 * can lie about. What actually keeps them out of the staff screens is that they
 * hold **no store permissions**, so `StorePermissionGuard` refuses every guarded
 * controller. This service is the thing that mints those accounts, which makes
 * it the place the invariant is most easily broken — so it writes the membership
 * row itself, with no `TenantUserRole`, no `UserStorePermission` and no
 * `UserStoreAccess`, rather than going anywhere near `setMemberRoles`.
 *
 * `TenantUser.role` still defaults to `CASHIER`, because the column is
 * `NOT NULL` with that default and this writes no role. That is inert today —
 * `TenantRoleGuard` is the only reader and no route in the codebase accepts
 * `CASHIER` — and the security spec pins it, so adding such a route fails a test
 * rather than quietly handing every employee the screen.
 */
@Injectable()
export class EmployeeLoginService {
    constructor(
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
        private readonly passwordPolicy: PasswordPolicyService,
    ) {}

    /**
     * Provision a brand-new login for an employee who has no ERP account.
     *
     * Returns the generated password **once**. It is stored only as a bcrypt
     * hash, so this response is the single moment it can be read; there is no
     * endpoint that returns it again, and `reset` below exists precisely because
     * the only recovery is to mint a new one.
     */
    async create(tenantId: string, employeeId: string, ctx: AuditContext) {
        const employee = await this.loadEmployee(tenantId, employeeId);

        if (employee.user_id) {
            throw new ConflictException(
                'This employee already has a login. Reset the password instead.',
            );
        }
        if (employee.status !== 'ACTIVE') {
            throw new BadRequestException('Only an active employee can be given a login.');
        }

        const mobile = this.requireMobile(employee.phone);

        // Checked before the write rather than left to the unique index, so the
        // caller gets the one message that tells them what to do about it. The
        // number may belong to the employee's own personal account — someone who
        // signed up to try the product and now works here — in which case the
        // answer is to link that account, not to mint a second one it could
        // never coexist with.
        const clash = await this.db.user.findUnique({
            where: { mobile },
            select: { id: true },
        });
        if (clash) {
            throw new ConflictException(
                'An account already uses this mobile number. Link that user to this employee instead.',
            );
        }

        // The same for the address, when the employee has a real one. A
        // placeholder cannot collide — it is keyed on the employee's own id —
        // but `User.email` is globally unique, so a shared family address or a
        // second workspace's owner would otherwise surface as a 500 from the
        // unique index rather than as something the caller can act on.
        const email = employee.email?.trim() || placeholderEmailFor(employee.id);
        if (employee.email?.trim()) {
            const emailClash = await this.db.user.findUnique({
                where: { email },
                select: { id: true },
            });
            if (emailClash) {
                throw new ConflictException(
                    'An account already uses this email address. Link that user to this employee instead.',
                );
            }
        }

        const password = generatePassword(await this.passwordPolicy.getForTenant(tenantId));
        const passwordHash = await bcrypt.hash(password, 10);

        // One transaction: a `User` with no membership is an account that can
        // sign in and see nothing, and an `Employee` pointing at a user that was
        // never created is a broken portal grant. Neither half is useful alone.
        await this.db.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    // A placeholder when they have no address: sign-in is by
                    // mobile, and the column is NOT NULL. See `placeholderEmailFor`.
                    email,
                    name: employee.name,
                    passwordHash,
                    mobile,
                    mobile_country_code: countryCodeFromE164(mobile) ?? DEFAULT_MOBILE_COUNTRY_CODE,
                    // HR chose this password and can read it off their screen, so
                    // it is good for exactly one sign-in.
                    must_change_password: true,
                },
                select: { id: true },
            });

            // Deliberately no `roles`, no `tenant_role_id`, and no store
            // permission or store access rows anywhere. See the class comment.
            await tx.tenantUser.create({
                data: { tenant_id: tenantId, user_id: user.id },
            });

            await tx.employee.update({
                where: { id: employee.id },
                data: { user_id: user.id, portal_access: true },
            });
        });

        await this.audit
            .log('EMPLOYEE_LOGIN_CREATED', 'Employee', { ...ctx, tenantId }, employee.id, {
                employee_code: employee.employee_code,
                mobile,
            })
            .catch(() => {});

        return this.describe(tenantId, employee.id, password);
    }

    /**
     * Mint a new password for an employee who has forgotten theirs.
     *
     * Same shape as `create` on purpose: HR reads the new password off the
     * screen and passes it on, and the employee must replace it on first use.
     * Every live session is revoked unconditionally here — unlike `revoke`,
     * where the bump is conditional — because the password itself changed, and
     * leaving sessions minted under the old one alive would defeat the reset.
     *
     * **Portal-only accounts only, and this is a privilege boundary rather than
     * a tidiness rule.** `MANAGE_HR` is not an owner-level permission, but
     * `Employee.user_id` may be linked to any tenant member — including the
     * owner, who commonly keeps an employee record of themselves for payroll.
     * Without this check, anyone holding `MANAGE_HR` could reset that account's
     * password, read it off this very screen, and sign in as the owner.
     */
    async reset(tenantId: string, employeeId: string, ctx: AuditContext) {
        const employee = await this.loadEmployee(tenantId, employeeId);
        const userId = this.requireLogin(employee.user_id);
        await this.assertPortalOnly(tenantId, userId);

        const password = generatePassword(await this.passwordPolicy.getForTenant(tenantId));
        const passwordHash = await bcrypt.hash(password, 10);

        await this.db.user.update({
            where: { id: userId },
            data: {
                passwordHash,
                must_change_password: true,
                // The same password works on the storefront and careers surfaces,
                // so revoking only the ERP session would leave the old one live
                // where it matters least and most respectively.
                token_version: { increment: 1 },
                storefront_token_version: { increment: 1 },
                applicant_token_version: { increment: 1 },
            },
        });

        await this.audit
            .log('EMPLOYEE_LOGIN_PASSWORD_RESET', 'Employee', { ...ctx, tenantId }, employee.id, {
                employee_code: employee.employee_code,
            })
            .catch(() => {});

        return this.describe(tenantId, employee.id, password);
    }

    /**
     * Take the login away.
     *
     * Clears `portal_access`, and — for an account whose only access *was* the
     * portal — bumps `token_version` too. The bump is what makes revocation
     * immediate: without it the employee keeps a valid access token until it
     * expires, and `EmployeeGuard` would refuse them while the rest of the API
     * still accepted the token.
     *
     * **It is conditional, and that condition matters.** `Employee.user_id` may
     * point at an account this service never minted — an owner who keeps an
     * employee record of themselves for payroll, say, linked through
     * `linkUser`. Bumping their `token_version` would sign them out of the ERP
     * entirely because somebody switched off a payslip screen. So the bump
     * applies only to a portal-only account — the same test billing already
     * derives membership from in `countPortalOnlyMembers`, which is exactly the
     * set of people for whom the portal is the whole of their access.
     *
     * The `User` row and the `TenantUser` membership are left alone either way.
     * Deleting them would cascade the audit trail's author and the attendance
     * punches that name them, and revocation is routinely temporary — someone
     * on unpaid leave comes back. `create` is therefore not the way back in;
     * granting portal access again is, which is the existing `setPortalAccess`
     * path.
     */
    async revoke(tenantId: string, employeeId: string, ctx: AuditContext) {
        const employee = await this.loadEmployee(tenantId, employeeId);
        const userId = this.requireLogin(employee.user_id);

        const portalOnly = await this.isPortalOnly(tenantId, userId);

        await this.db.$transaction(async (tx) => {
            await tx.employee.update({
                where: { id: employee.id },
                data: { portal_access: false },
            });
            if (portalOnly) {
                await tx.user.update({
                    where: { id: userId },
                    data: { token_version: { increment: 1 } },
                });
            }
        });

        await this.audit
            .log('EMPLOYEE_LOGIN_REVOKED', 'Employee', { ...ctx, tenantId }, employee.id, {
                employee_code: employee.employee_code,
                sessions_revoked: portalOnly,
            })
            .catch(() => {});

        return this.describe(tenantId, employee.id);
    }

    /**
     * What the HR screen needs to render the login panel, for one employee.
     *
     * `password` is present only on the response to the call that just generated
     * one. Everything else here is derivable from the employee row, which is why
     * reading it needs no separate endpoint.
     */
    private async describe(tenantId: string, employeeId: string, password?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId },
            select: {
                id: true,
                portal_access: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        mobile: true,
                        must_change_password: true,
                    },
                },
            },
        });

        return {
            employee_id: employee?.id ?? employeeId,
            has_login: !!employee?.user,
            portal_access: employee?.portal_access ?? false,
            // What they type into the sign-in form. Null only for a login linked
            // from a pre-existing account that never recorded a number, which
            // signs in by email instead.
            sign_in_identifier: employee?.user?.mobile ?? null,
            must_change_password: employee?.user?.must_change_password ?? false,
            ...(password ? { password } : {}),
        };
    }

    private async loadEmployee(tenantId: string, employeeId: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                status: true,
                user_id: true,
                employee_code: true,
            },
        });
        if (!employee) throw new NotFoundException('Employee not found.');
        return employee;
    }

    /**
     * Whether the portal is the whole of this account's access in this tenant.
     *
     * Deliberately the same rule as `countPortalOnlyMembers`, including the
     * `OWNER` clause — **an owner bypasses `StorePermissionGuard` outright**, so
     * counting permission rows alone would read an owner with none as a portal
     * user and let this service act on their account.
     */
    private async isPortalOnly(tenantId: string, userId: string): Promise<boolean> {
        const [membership, staffPermissions] = await Promise.all([
            this.db.tenantUser.findFirst({
                where: { tenant_id: tenantId, user_id: userId },
                select: { role: true },
            }),
            this.db.userStorePermission.count({
                where: { user_id: userId, tenant_id: tenantId },
            }),
        ]);

        return membership?.role !== 'OWNER' && staffPermissions === 0;
    }

    private async assertPortalOnly(tenantId: string, userId: string): Promise<void> {
        if (await this.isPortalOnly(tenantId, userId)) return;
        throw new ForbiddenException(
            'This employee is linked to a staff account. They can change their own password from their profile.',
        );
    }

    private requireLogin(userId: string | null): string {
        if (!userId) {
            throw new BadRequestException('This employee does not have a login yet.');
        }
        return userId;
    }

    /**
     * The employee's phone as E.164, which is what `authenticateByMobile` looks
     * up. `Employee.phone` is required and unique per tenant but free text —
     * imports and the add form both accept `01700100057` — so it is normalised
     * here rather than assumed.
     */
    private requireMobile(phone: string | null | undefined): string {
        const mobile = resolveMobileToE164(phone ?? '', DEFAULT_MOBILE_COUNTRY_CODE);
        if (!mobile) {
            throw new BadRequestException(
                'This employee needs a valid mobile number before they can be given a login.',
            );
        }
        return mobile;
    }
}
