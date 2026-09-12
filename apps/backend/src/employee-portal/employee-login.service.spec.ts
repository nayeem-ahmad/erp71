import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DEFAULT_PASSWORD_POLICY, evaluatePassword, isPlaceholderEmail } from '@erp71/shared-types';
import { EmployeeLoginService } from './employee-login.service';

/**
 * Provisioning a login is the one place the portal's security model can be
 * broken by accident, so most of what is asserted here is what the writes must
 * *not* contain — see the class comment on `EmployeeLoginService`.
 */
describe('EmployeeLoginService', () => {
    const TENANT = 'tenant-1';

    const EMPLOYEE = {
        id: 'emp-1',
        name: 'Rahim Uddin',
        phone: '01700100057',
        email: null as string | null,
        status: 'ACTIVE',
        user_id: null as string | null,
        employee_code: 'EMP-00001',
    };

    let db: any;
    let audit: any;
    let policy: any;
    let service: EmployeeLoginService;
    /** The writes the transaction callback made, in order. */
    let tx: any;

    beforeEach(() => {
        tx = {
            user: { create: jest.fn().mockResolvedValue({ id: 'user-new' }) },
            tenantUser: { create: jest.fn().mockResolvedValue({}) },
            employee: { update: jest.fn().mockResolvedValue({}) },
        };

        db = {
            employee: {
                findFirst: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
            user: {
                // Serves both the mobile and the email clash checks.
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockResolvedValue({}),
            },
            // No permissions and a non-OWNER role means the portal is the whole
            // of this account's access — the same test `countPortalOnlyMembers`
            // derives billing from.
            userStorePermission: { count: jest.fn().mockResolvedValue(0) },
            tenantUser: { findFirst: jest.fn().mockResolvedValue({ role: 'CASHIER' }) },
            $transaction: jest.fn(async (fn: any) => fn(tx)),
        };

        audit = { log: jest.fn().mockResolvedValue(undefined) };
        policy = { getForTenant: jest.fn().mockResolvedValue(DEFAULT_PASSWORD_POLICY) };

        // First call resolves the employee to act on; the second is `describe`
        // re-reading it for the response.
        db.employee.findFirst
            .mockResolvedValueOnce({ ...EMPLOYEE })
            .mockResolvedValue({
                id: 'emp-1',
                portal_access: true,
                user: {
                    id: 'user-new',
                    email: 'emp-emp-1@employee.erp71.invalid',
                    mobile: '+8801700100057',
                    must_change_password: true,
                },
            });

        service = new EmployeeLoginService(db, audit, policy);
    });

    describe('create', () => {
        it('writes a membership with no role and no store permission', async () => {
            await service.create(TENANT, 'emp-1', { userId: 'hr-1' });

            expect(tx.tenantUser.create).toHaveBeenCalledTimes(1);
            const membership = tx.tenantUser.create.mock.calls[0][0].data;
            expect(membership).toEqual({ tenant_id: TENANT, user_id: 'user-new' });
            // The invariant the whole portal rests on. A `roles` or
            // `tenant_role_id` here would make this person staff, and a store
            // permission would open every guarded controller to them.
            expect(membership).not.toHaveProperty('roles');
            expect(membership).not.toHaveProperty('tenant_role_id');
            expect(membership).not.toHaveProperty('role');

            // And nothing anywhere else in the transaction grants one either.
            expect(tx).not.toHaveProperty('userStorePermission');
            expect(tx).not.toHaveProperty('userStoreAccess');
        });

        it('normalises the employee phone to E.164 as the sign-in identifier', async () => {
            await service.create(TENANT, 'emp-1', {});
            expect(tx.user.create.mock.calls[0][0].data.mobile).toBe('+8801700100057');
        });

        it('gives an employee with no email a placeholder rather than failing', async () => {
            await service.create(TENANT, 'emp-1', {});
            const { email } = tx.user.create.mock.calls[0][0].data;
            expect(isPlaceholderEmail(email)).toBe(true);
        });

        it('keeps a real email when the employee has one', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst
                .mockResolvedValueOnce({ ...EMPLOYEE, email: '  rahim@shop.com.bd ' })
                .mockResolvedValue({ id: 'emp-1', portal_access: true, user: null });

            await service.create(TENANT, 'emp-1', {});
            expect(tx.user.create.mock.calls[0][0].data.email).toBe('rahim@shop.com.bd');
        });

        it('stores the password only as a hash, and returns the plaintext once', async () => {
            const result = await service.create(TENANT, 'emp-1', {});
            const { passwordHash } = tx.user.create.mock.calls[0][0].data;

            expect(passwordHash).not.toBe(result.password);
            expect(await bcrypt.compare(result.password, passwordHash)).toBe(true);
        });

        it('generates a password the workspace policy accepts', async () => {
            const strict = {
                min_length: 16,
                require_uppercase: true,
                require_lowercase: true,
                require_number: true,
                require_symbol: true,
                block_common: true,
            };
            policy.getForTenant.mockResolvedValue(strict);

            const result = await service.create(TENANT, 'emp-1', {});
            expect(evaluatePassword(result.password, strict).valid).toBe(true);
        });

        it('marks the account as owing a password change', async () => {
            await service.create(TENANT, 'emp-1', {});
            expect(tx.user.create.mock.calls[0][0].data.must_change_password).toBe(true);
        });

        it('grants portal access in the same transaction as the link', async () => {
            await service.create(TENANT, 'emp-1', {});
            expect(tx.employee.update).toHaveBeenCalledWith({
                where: { id: 'emp-1' },
                data: { user_id: 'user-new', portal_access: true },
            });
        });

        it('refuses an employee who already has a login', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, user_id: 'user-existing' });

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(ConflictException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('refuses when the address already belongs to another account', async () => {
            // `User.email` is globally unique, so without this the collision
            // arrives as a 500 from the index rather than as something the
            // caller can act on.
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, email: 'shared@shop.com.bd' });
            db.user.findUnique.mockImplementation(({ where }: any) =>
                Promise.resolve(where.email ? { id: 'user-someone-else' } : null),
            );

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(ConflictException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('does not look for a clash on a placeholder address', async () => {
            // It is keyed on the employee's own id, so it cannot collide — and
            // a lookup would be a query per provisioning for no possible answer.
            await service.create(TENANT, 'emp-1', {});
            const lookups = db.user.findUnique.mock.calls.map(([arg]: any) => arg.where);
            expect(lookups.every((where: any) => !where.email)).toBe(true);
        });

        it('refuses when the number already belongs to another account', async () => {
            // The unique index would catch this too, but as a 500. The point of
            // checking first is the message, which tells the caller to link that
            // account rather than mint a second one.
            db.user.findUnique.mockResolvedValue({ id: 'user-someone-else' });

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(ConflictException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('refuses an employee whose phone is not a usable mobile number', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, phone: 'ext. 214' });

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(BadRequestException);
            expect(db.$transaction).not.toHaveBeenCalled();
        });

        it('refuses an inactive employee', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, status: 'RESIGNED' });

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(BadRequestException);
        });

        it('refuses an employee in another tenant', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue(null);

            await expect(service.create(TENANT, 'emp-1', {})).rejects.toThrow(NotFoundException);
            // Scoped in the query, not after the fact.
            expect(db.employee.findFirst.mock.calls[0][0].where).toMatchObject({
                id: 'emp-1',
                tenant_id: TENANT,
                deleted_at: null,
            });
        });

        it('does not put the password in the audit trail', async () => {
            const result = await service.create(TENANT, 'emp-1', { userId: 'hr-1' });
            expect(audit.log).toHaveBeenCalledWith(
                'EMPLOYEE_LOGIN_CREATED',
                'Employee',
                expect.objectContaining({ userId: 'hr-1', tenantId: TENANT }),
                'emp-1',
                expect.anything(),
            );
            expect(JSON.stringify(audit.log.mock.calls[0])).not.toContain(result.password);
        });
    });

    describe('reset', () => {
        beforeEach(() => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst
                .mockResolvedValueOnce({ ...EMPLOYEE, user_id: 'user-1' })
                .mockResolvedValue({
                    id: 'emp-1',
                    portal_access: true,
                    user: { id: 'user-1', email: 'x@y.z', mobile: '+8801700100057', must_change_password: true },
                });
        });

        it('revokes every surface, not just the ERP session', async () => {
            await service.reset(TENANT, 'emp-1', {});
            const { data } = db.user.update.mock.calls[0][0];
            expect(data.token_version).toEqual({ increment: 1 });
            expect(data.storefront_token_version).toEqual({ increment: 1 });
            expect(data.applicant_token_version).toEqual({ increment: 1 });
        });

        it('sets a fresh hash and re-arms the forced change', async () => {
            const result = await service.reset(TENANT, 'emp-1', {});
            const { data } = db.user.update.mock.calls[0][0];
            expect(data.must_change_password).toBe(true);
            expect(await bcrypt.compare(result.password, data.passwordHash)).toBe(true);
        });

        /**
         * `MANAGE_HR` is not owner-level, and `reset` puts a working password on
         * the screen of whoever called it. If it would act on a staff account,
         * anyone holding `MANAGE_HR` could take over the workspace.
         */
        it('refuses to reset a staff account the employee is linked to', async () => {
            db.userStorePermission.count.mockResolvedValue(2);

            await expect(service.reset(TENANT, 'emp-1', {})).rejects.toThrow(ForbiddenException);
            expect(db.user.update).not.toHaveBeenCalled();
        });

        it("refuses to reset an owner's account, which holds no permission rows at all", async () => {
            // The case counting permissions alone would miss: an OWNER bypasses
            // `StorePermissionGuard` outright, so zero rows says nothing.
            db.userStorePermission.count.mockResolvedValue(0);
            db.tenantUser.findFirst.mockResolvedValue({ role: 'OWNER' });

            await expect(service.reset(TENANT, 'emp-1', {})).rejects.toThrow(ForbiddenException);
            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('refuses an employee with no login to reset', async () => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, user_id: null });

            await expect(service.reset(TENANT, 'emp-1', {})).rejects.toThrow(BadRequestException);
            expect(db.user.update).not.toHaveBeenCalled();
        });
    });

    describe('revoke', () => {
        beforeEach(() => {
            db.employee.findFirst.mockReset();
            db.employee.findFirst
                .mockResolvedValueOnce({ ...EMPLOYEE, user_id: 'user-1' })
                .mockResolvedValue({
                    id: 'emp-1',
                    portal_access: false,
                    user: { id: 'user-1', email: 'x@y.z', mobile: '+8801700100057', must_change_password: false },
                });
            tx.user = { update: jest.fn().mockResolvedValue({}) };
        });

        it('clears portal access and kills the live session', async () => {
            await service.revoke(TENANT, 'emp-1', {});

            expect(tx.employee.update).toHaveBeenCalledWith({
                where: { id: 'emp-1' },
                data: { portal_access: false },
            });
            // Without the bump they keep a valid token until it expires, and
            // `EmployeeGuard` would refuse them while the rest of the API did not.
            expect(tx.user.update).toHaveBeenCalledWith({
                where: { id: 'user-1' },
                data: { token_version: { increment: 1 } },
            });
        });

        it("does not sign out an owner, whose permission rows are empty by design", async () => {
            db.userStorePermission.count.mockResolvedValue(0);
            db.tenantUser.findFirst.mockResolvedValue({ role: 'OWNER' });

            await service.revoke(TENANT, 'emp-1', {});

            expect(tx.employee.update).toHaveBeenCalled();
            expect(tx.user.update).not.toHaveBeenCalled();
        });

        it('does not sign out an account that also holds staff permissions', async () => {
            // `Employee.user_id` may point at an owner who keeps an employee
            // record of themselves for payroll. Switching off their payslip
            // screen must not sign them out of the whole ERP.
            db.userStorePermission.count.mockResolvedValue(3);

            await service.revoke(TENANT, 'emp-1', {});

            expect(tx.employee.update).toHaveBeenCalled();
            expect(tx.user.update).not.toHaveBeenCalled();
        });

        it('scopes the portal-only check to this tenant', async () => {
            // A permission or a role held at another workspace says nothing
            // about whether the portal is the whole of their access *here*.
            await service.revoke(TENANT, 'emp-1', {});
            expect(db.userStorePermission.count).toHaveBeenCalledWith({
                where: { user_id: 'user-1', tenant_id: TENANT },
            });
            expect(db.tenantUser.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: TENANT, user_id: 'user-1' },
                select: { role: true },
            });
        });

        it('records whether sessions were actually revoked', async () => {
            db.userStorePermission.count.mockResolvedValue(3);
            await service.revoke(TENANT, 'emp-1', {});
            expect(audit.log).toHaveBeenCalledWith(
                'EMPLOYEE_LOGIN_REVOKED',
                'Employee',
                expect.anything(),
                'emp-1',
                expect.objectContaining({ sessions_revoked: false }),
            );
        });

        it('leaves the user and the membership in place', async () => {
            // Deleting them would cascade the audit trail and the attendance
            // punches that name this person, and revocation is routinely
            // temporary.
            await service.revoke(TENANT, 'emp-1', {});
            expect(tx.tenantUser.create).not.toHaveBeenCalled();
            expect(tx).not.toHaveProperty('tenantUser.delete');
        });
    });
});
