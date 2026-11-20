import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeLinkService, MAX_BULK_LINKS } from './employee-link.service';

describe('EmployeeLinkService', () => {
    let db: any;
    let employees: { linkUser: jest.Mock };
    let service: EmployeeLinkService;

    const member = (id: string, overrides: Record<string, unknown> = {}) => ({
        user: { id, name: null, email: `${id}@example.com`, mobile: null, ...overrides },
    });

    beforeEach(() => {
        db = {
            employee: { findFirst: jest.fn(), findMany: jest.fn() },
            tenantUser: { findFirst: jest.fn(), findMany: jest.fn() },
        };
        employees = { linkUser: jest.fn().mockResolvedValue({}) };
        service = new EmployeeLinkService(db, employees as any);
    });

    describe('loginCandidates', () => {
        it('offers only logins no live card holds, the matching one first', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', name: 'Karim', phone: '01700100057', email: null });
            db.tenantUser.findMany.mockResolvedValue([
                member('u-taken'),
                member('u-other', { name: 'Abdul' }),
                member('u-karim', { mobile: '+8801700100057' }),
            ]);
            db.employee.findMany.mockResolvedValue([{ user_id: 'u-taken' }]);

            const rows = await service.loginCandidates('t1', 'e1');

            expect(rows.map((row) => row.userId)).toEqual(['u-karim', 'u-other']);
            expect(rows[0].matches).toEqual(['mobile']);
            expect(db.employee.findMany).toHaveBeenCalledWith({
                where: { tenant_id: 't1', deleted_at: null, user_id: { not: null } },
                select: { user_id: true },
            });
        });

        it('hides a placeholder address rather than showing a machine one', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'e1', name: 'Karim', phone: '', email: null });
            db.tenantUser.findMany.mockResolvedValue([member('u1', { email: 'emp-x@employee.erp71.invalid' })]);
            db.employee.findMany.mockResolvedValue([]);

            const [row] = await service.loginCandidates('t1', 'e1');

            expect(row.email).toBeNull();
        });

        it('scopes the card to the caller\'s branch', async () => {
            db.employee.findFirst.mockResolvedValue(null);

            await expect(service.loginCandidates('t1', 'e1', 'store-a')).rejects.toThrow(NotFoundException);
            expect(db.employee.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ store_id: 'store-a' }) }),
            );
        });
    });

    describe('employeeCandidates', () => {
        it('lists unlinked cards still on the books for a member of this workspace', async () => {
            db.tenantUser.findFirst.mockResolvedValue(member('u1', { email: 'k@shop.com' }));
            db.employee.findMany.mockResolvedValue([
                { id: 'e2', employee_code: 'EMP-2', name: 'Abdul', phone: '017', email: null, status: 'ACTIVE' },
                { id: 'e1', employee_code: 'EMP-1', name: 'Karim', phone: '018', email: 'k@shop.com', status: 'ACTIVE' },
            ]);

            const rows = await service.employeeCandidates('t1', { userId: 'u1' }, 'store-a');

            expect(rows.map((row) => row.employeeId)).toEqual(['e1', 'e2']);
            expect(db.employee.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        tenant_id: 't1',
                        deleted_at: null,
                        user_id: null,
                        status: { in: ['ACTIVE', 'PROBATION'] },
                        store_id: 'store-a',
                    },
                }),
            );
        });

        it('refuses a user who is not a member of the workspace', async () => {
            db.tenantUser.findFirst.mockResolvedValue(null);

            await expect(service.employeeCandidates('t1', { userId: 'u-stranger' })).rejects.toThrow(NotFoundException);
        });

        it('ranks by the address being invited when there is no login yet', async () => {
            db.employee.findMany.mockResolvedValue([
                { id: 'e2', employee_code: 'EMP-2', name: 'Abdul', phone: '017', email: null, status: 'ACTIVE' },
                { id: 'e1', employee_code: 'EMP-1', name: 'Karim', phone: '018', email: 'k@shop.com', status: 'ACTIVE' },
            ]);

            const rows = await service.employeeCandidates('t1', { email: 'K@shop.com' });

            expect(rows[0]).toEqual(expect.objectContaining({ employeeId: 'e1', matches: ['email'] }));
            expect(db.tenantUser.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('suggestions', () => {
        it('pairs a card with the one login its mobile names', async () => {
            db.employee.findMany
                .mockResolvedValueOnce([
                    { id: 'e1', employee_code: 'EMP-1', name: 'Karim', phone: '01700100057', email: null, status: 'ACTIVE' },
                ])
                .mockResolvedValueOnce([]);
            db.tenantUser.findMany.mockResolvedValue([member('u1', { mobile: '+8801700100057' })]);

            const pairs = await service.suggestions('t1');

            expect(pairs).toEqual([
                expect.objectContaining({
                    employee: expect.objectContaining({ id: 'e1' }),
                    user: expect.objectContaining({ id: 'u1' }),
                    matches: ['mobile'],
                }),
            ]);
        });
    });

    describe('linkMany', () => {
        const ctx = { userId: 'hr-1' };

        it('links through linkUser and reports a failure without stopping the rest', async () => {
            employees.linkUser
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new ConflictException('This user is already linked to another employee.'))
                .mockResolvedValueOnce({});

            const result = await service.linkMany(
                't1',
                [
                    { employeeId: 'e1', userId: 'u1' },
                    { employeeId: 'e2', userId: 'u2' },
                    { employeeId: 'e3', userId: 'u3' },
                ],
                'store-a',
                ctx,
            );

            expect(result.linked).toBe(2);
            expect(result.results[1]).toEqual({
                employeeId: 'e2',
                userId: 'u2',
                ok: false,
                error: 'This user is already linked to another employee.',
            });
            expect(employees.linkUser).toHaveBeenCalledWith('t1', 'e1', 'u1', 'store-a', ctx);
        });

        it('refuses a page that names the same card or login twice', async () => {
            await expect(
                service.linkMany('t1', [
                    { employeeId: 'e1', userId: 'u1' },
                    { employeeId: 'e1', userId: 'u2' },
                ], undefined, ctx),
            ).rejects.toThrow(BadRequestException);
            expect(employees.linkUser).not.toHaveBeenCalled();
        });

        it('refuses an empty or oversized page', async () => {
            await expect(service.linkMany('t1', [], undefined, ctx)).rejects.toThrow(BadRequestException);
            const many = Array.from({ length: MAX_BULK_LINKS + 1 }, (_, i) => ({ employeeId: `e${i}`, userId: `u${i}` }));
            await expect(service.linkMany('t1', many, undefined, ctx)).rejects.toThrow(BadRequestException);
        });
    });
});
