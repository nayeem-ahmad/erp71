import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SalaryStructuresService } from './salary-structures.service';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';

const COMPONENTS = [
    { id: 'c-basic', name: 'Basic', kind: 'EARNING', calculation: 'FIXED', is_basic: true, is_taxable: true, sort_order: 0 },
    { id: 'c-house', name: 'House Rent', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: false, is_taxable: true, sort_order: 1 },
];

describe('SalaryStructuresService', () => {
    let service: SalaryStructuresService;
    let db: any;

    beforeEach(async () => {
        db = {
            salaryComponent: {
                findMany: jest.fn().mockResolvedValue(COMPONENTS),
                findFirst: jest.fn().mockResolvedValue(null),
                count: jest.fn().mockResolvedValue(0),
                create: jest.fn().mockResolvedValue({}),
                createMany: jest.fn().mockResolvedValue({ count: 5 }),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            employeeSalaryStructure: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({}),
            },
            employeeSalaryStructureLine: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            employeeBankAccount: {
                findFirst: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockImplementation(async ({ create, update }: any) => ({ ...create, ...update })),
            },
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1', basic_salary: 25000 }) },
        };
        db.$transaction = jest.fn(async (cb: any) => cb(db));

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SalaryStructuresService,
                { provide: DatabaseService, useValue: db },
                {
                    provide: EncryptionService,
                    useValue: {
                        encrypt: jest.fn((v: string) => `enc:${v}`),
                        decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
                    },
                },
            ],
        }).compile();
        service = module.get(SalaryStructuresService);
    });

    describe('components', () => {
        it('seeds the Bangladeshi split for a tenant with none', async () => {
            const result = await service.ensureDefaultComponents('t1');
            expect(result.created).toBe(5);
            const names = db.salaryComponent.createMany.mock.calls[0][0].data.map((c: any) => c.name);
            expect(names).toEqual(['Basic', 'House Rent', 'Medical Allowance', 'Conveyance', 'Provident Fund']);
        });

        it('does not re-seed a tenant that already has components', async () => {
            // Checked on *any* component, so a tenant that deliberately deleted
            // the seeded set does not have it grow back.
            db.salaryComponent.count.mockResolvedValue(1);
            const result = await service.ensureDefaultComponents('t1');
            expect(result.created).toBe(0);
            expect(db.salaryComponent.createMany).not.toHaveBeenCalled();
        });

        it('refuses a basic component that is a percentage of itself', async () => {
            await expect(service.createComponent('t1', {
                name: 'Basic', kind: 'EARNING', calculation: 'PERCENT_OF_BASIC', is_basic: true,
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses a basic component that is a deduction', async () => {
            await expect(service.createComponent('t1', {
                name: 'Basic', kind: 'DEDUCTION', is_basic: true,
            })).rejects.toThrow(BadRequestException);
        });

        it('demotes the previous basic when a new one is set', async () => {
            await service.createComponent('t1', { name: 'New Basic', kind: 'EARNING', is_basic: true });
            expect(db.salaryComponent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: { is_basic: false },
            }));
        });

        it('refuses a duplicate name', async () => {
            db.salaryComponent.findFirst.mockResolvedValue({ id: 'c-1' });
            await expect(service.createComponent('t1', { name: 'Basic', kind: 'EARNING' }))
                .rejects.toThrow(ConflictException);
        });

        it('refuses to delete the basic component', async () => {
            db.salaryComponent.findFirst.mockResolvedValue({ id: 'c-basic', is_basic: true });
            await expect(service.deleteComponent('t1', 'c-basic')).rejects.toThrow(BadRequestException);
        });

        it('soft-deletes so old structures keep computing', async () => {
            db.salaryComponent.findFirst.mockResolvedValue({ id: 'c-house', is_basic: false });
            await service.deleteComponent('t1', 'c-house');
            expect(db.salaryComponent.update.mock.calls[0][0].data.deleted_at).toBeInstanceOf(Date);
        });
    });

    describe('setStructure', () => {
        const dto = {
            employee_id: 'emp-1',
            effective_from: '2026-08-01',
            lines: [
                { component_id: 'c-basic', value: 20000 },
                { component_id: 'c-house', value: 50 },
            ],
        };

        it('creates a dated revision', async () => {
            await service.setStructure('t1', dto);
            const data = db.employeeSalaryStructure.create.mock.calls[0][0].data;
            expect(data.effective_from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
            expect(data.lines.create).toHaveLength(2);
        });

        it('refuses a structure with no basic line', async () => {
            // Without it every percentage computes to zero, so the structure
            // looks complete and pays almost nothing.
            await expect(service.setStructure('t1', {
                ...dto, lines: [{ component_id: 'c-house', value: 50 }],
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses a line referencing an unknown component', async () => {
            await expect(service.setStructure('t1', {
                ...dto, lines: [...dto.lines, { component_id: 'c-nope', value: 1 }],
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses a negative line', async () => {
            await expect(service.setStructure('t1', {
                ...dto, lines: [{ component_id: 'c-basic', value: -1 }],
            })).rejects.toThrow(BadRequestException);
        });

        it('refuses an employee from another tenant', async () => {
            db.employee.findFirst.mockResolvedValue(null);
            await expect(service.setStructure('t1', dto)).rejects.toThrow(NotFoundException);
        });

        it('rewrites the lines when a structure already exists on that date', async () => {
            // Same date is a correction, not a second revision.
            db.employeeSalaryStructure.findFirst.mockResolvedValue({ id: 'str-1' });
            await service.setStructure('t1', dto);
            expect(db.employeeSalaryStructureLine.deleteMany).toHaveBeenCalledWith({
                where: { structure_id: 'str-1' },
            });
            expect(db.employeeSalaryStructure.create).not.toHaveBeenCalled();
        });
    });

    describe('resolveStructure', () => {
        it('uses the structure in force on the date', async () => {
            db.employeeSalaryStructure.findMany.mockResolvedValue([
                {
                    effective_from: new Date(Date.UTC(2026, 0, 1)),
                    lines: [
                        { component_id: 'c-basic', value: 20000 },
                        { component_id: 'c-house', value: 50 },
                    ],
                },
            ]);

            const result = await service.resolveStructure('t1', 'emp-1', new Date(Date.UTC(2026, 7, 1)));

            expect(result.source).toBe('STRUCTURE');
            expect(result.grossEarnings).toBe(30000);
        });

        it('falls back to Employee.basic_salary when there is no structure', async () => {
            // This fallback is why Phase 5 does not break every tenant that has
            // not opened the new screen, and why basic_salary was not dropped.
            const result = await service.resolveStructure('t1', 'emp-1', new Date());
            expect(result.source).toBe('BASIC_SALARY');
            expect(result.basic).toBe(25000);
            expect(result.grossEarnings).toBe(25000);
        });

        it('falls back to the whole salary as one earning when no components exist', async () => {
            db.salaryComponent.findMany.mockResolvedValue([]);
            const result = await service.resolveStructure('t1', 'emp-1', new Date());
            expect(result.grossEarnings).toBe(25000);
        });

        it('treats an employee with no salary at all as zero, not as an error', async () => {
            db.employee.findFirst.mockResolvedValue({ id: 'emp-1', basic_salary: null });
            const result = await service.resolveStructure('t1', 'emp-1', new Date());
            expect(result.grossEarnings).toBe(0);
        });

        it('ignores a structure dated after the month being resolved', async () => {
            db.employeeSalaryStructure.findMany.mockResolvedValue([
                { effective_from: new Date(Date.UTC(2027, 0, 1)), lines: [{ component_id: 'c-basic', value: 99999 }] },
            ]);
            const result = await service.resolveStructure('t1', 'emp-1', new Date(Date.UTC(2026, 7, 1)));
            expect(result.source).toBe('BASIC_SALARY');
        });
    });

    describe('bank accounts', () => {
        it('encrypts the account number at rest and returns it decrypted', async () => {
            const saved = await service.setBankAccount('t1', 'emp-1', {
                method: 'BANK', bank_name: 'BRAC', account_number: '1234567890',
            });

            const written = db.employeeBankAccount.upsert.mock.calls[0][0].create;
            expect(written.account_number).toBe('enc:1234567890');
            expect(saved.account_number).toBe('1234567890');
        });

        it('encrypts the wallet number too', async () => {
            await service.setBankAccount('t1', 'emp-1', { method: 'BKASH', wallet_number: '01700000000' });
            expect(db.employeeBankAccount.upsert.mock.calls[0][0].create.wallet_number)
                .toBe('enc:01700000000');
        });

        it('requires an account number for bank payment', async () => {
            await expect(service.setBankAccount('t1', 'emp-1', { method: 'BANK' }))
                .rejects.toThrow(BadRequestException);
        });

        it('requires a wallet number for mobile money', async () => {
            await expect(service.setBankAccount('t1', 'emp-1', { method: 'NAGAD' }))
                .rejects.toThrow(BadRequestException);
        });

        it('allows cash with nothing else', async () => {
            await expect(service.setBankAccount('t1', 'emp-1', { method: 'CASH' })).resolves.toBeDefined();
        });

        it('returns null rather than throwing for an employee with no details', async () => {
            expect(await service.getBankAccount('t1', 'emp-1')).toBeNull();
        });
    });
});
