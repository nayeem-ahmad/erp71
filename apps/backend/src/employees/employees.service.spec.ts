import { Test, TestingModule } from '@nestjs/testing';
import { EmployeesService } from './employees.service';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let db: any;
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(async () => {
    encryption = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
    };

    db = {
      employee: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      department: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      designation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      tenantUser: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: DatabaseService, useValue: db },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
    jest.clearAllMocks();
  });

  // ── Departments ──────────────────────────────────────────────────────────

  describe('listDepartments', () => {
    it('returns departments for a tenant', async () => {
      const depts = [{ id: 'd1', name: 'Sales', tenant_id: 't1', deleted_at: null }];
      db.department.findMany.mockResolvedValue(depts);

      const result = await service.listDepartments('t1');

      expect(result).toEqual(depts);
      expect(db.department.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 't1', deleted_at: null },
        orderBy: { name: 'asc' },
      });
    });

    it('returns empty array when tenant has no departments', async () => {
      db.department.findMany.mockResolvedValue([]);

      const result = await service.listDepartments('t1');

      expect(result).toEqual([]);
    });
  });

  describe('createDepartment', () => {
    it('creates a new department when name is unique', async () => {
      db.department.findFirst.mockResolvedValue(null);
      db.department.create.mockResolvedValue({ id: 'd1', name: 'HR', tenant_id: 't1' });

      const result = await service.createDepartment('t1', { name: 'HR' });

      expect(result.id).toBe('d1');
      expect(db.department.create).toHaveBeenCalledWith({
        data: { tenant_id: 't1', name: 'HR' },
      });
    });

    it('throws ConflictException when department name already exists', async () => {
      db.department.findFirst.mockResolvedValue({ id: 'd1', name: 'HR' });

      await expect(service.createDepartment('t1', { name: 'HR' })).rejects.toThrow(ConflictException);
    });
  });

  // ── Designations ─────────────────────────────────────────────────────────

  describe('listDesignations', () => {
    it('returns designations for a tenant', async () => {
      const desigs = [{ id: 'dsg1', name: 'Manager', tenant_id: 't1' }];
      db.designation.findMany.mockResolvedValue(desigs);

      const result = await service.listDesignations('t1');

      expect(result).toEqual(desigs);
      expect(db.designation.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 't1', deleted_at: null },
        orderBy: { name: 'asc' },
      });
    });

    it('returns empty array when no designations exist', async () => {
      db.designation.findMany.mockResolvedValue([]);

      const result = await service.listDesignations('t1');

      expect(result).toEqual([]);
    });
  });

  describe('createDesignation', () => {
    it('creates a designation when name is unique', async () => {
      db.designation.findFirst.mockResolvedValue(null);
      db.designation.create.mockResolvedValue({ id: 'dsg1', name: 'Cashier', tenant_id: 't1' });

      const result = await service.createDesignation('t1', { name: 'Cashier' });

      expect(result.id).toBe('dsg1');
    });

    it('throws ConflictException when designation name already exists', async () => {
      db.designation.findFirst.mockResolvedValue({ id: 'dsg1', name: 'Cashier' });

      await expect(service.createDesignation('t1', { name: 'Cashier' })).rejects.toThrow(ConflictException);
    });
  });

  // ── Employees ─────────────────────────────────────────────────────────────

  describe('create', () => {
    const baseDto: any = {
      name: 'Alice',
      phone: '01700000000',
      department_id: null,
      designation_id: null,
    };

    const createdEmployee = {
      id: 'emp-1',
      name: 'Alice',
      phone: '01700000000',
      employee_code: 'EMP-00001',
      nid: null,
      department: null,
      designation: null,
      user: null,
    };

    it('creates an employee and generates first employee code EMP-00001', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null) // phone uniqueness check
        .mockResolvedValueOnce(null); // generateEmployeeCode → no last
      db.employee.create.mockResolvedValue(createdEmployee);

      const result = await service.create('t1', baseDto);

      expect(result.id).toBe('emp-1');
      expect(db.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employee_code: 'EMP-00001' }),
        }),
      );
    });

    it('increments employee code based on last existing code', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null) // phone uniqueness
        .mockResolvedValueOnce({ employee_code: 'EMP-00042' }); // generateEmployeeCode
      db.employee.create.mockResolvedValue({ ...createdEmployee, employee_code: 'EMP-00043' });

      await service.create('t1', baseDto);

      expect(db.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employee_code: 'EMP-00043' }),
        }),
      );
    });

    it('throws BadRequestException when phone already exists', async () => {
      db.employee.findFirst.mockResolvedValueOnce({ id: 'emp-existing' });

      await expect(service.create('t1', baseDto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when department_id is invalid', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null) // phone check
        .mockResolvedValueOnce(null); // generateEmployeeCode
      db.department.findFirst.mockResolvedValue(null); // dept not found

      await expect(
        service.create('t1', { ...baseDto, department_id: 'bad-dept' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when designation_id is invalid', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null) // phone check
        .mockResolvedValueOnce(null); // generateEmployeeCode
      db.department.findFirst.mockResolvedValue({ id: 'dept-1' }); // dept ok
      db.designation.findFirst.mockResolvedValue(null); // designation not found

      await expect(
        service.create('t1', { ...baseDto, department_id: 'dept-1', designation_id: 'bad-desig' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('encrypts NID when provided', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      db.employee.create.mockResolvedValue({ ...createdEmployee, nid: 'enc:123456789' });

      const result = await service.create('t1', { ...baseDto, nid: '123456789' });

      expect(encryption.encrypt).toHaveBeenCalledWith('123456789');
      // nid returned should be decrypted (encrypt mock prefixes enc:, decrypt removes it)
      expect(result.nid).toBe('123456789');
    });

    it('creates employee with valid department and designation', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(null) // phone check
        .mockResolvedValueOnce(null); // generateEmployeeCode
      db.department.findFirst.mockResolvedValue({ id: 'dept-1' });
      db.designation.findFirst.mockResolvedValue({ id: 'desig-1' });
      db.employee.create.mockResolvedValue(createdEmployee);

      const result = await service.create('t1', {
        ...baseDto,
        department_id: 'dept-1',
        designation_id: 'desig-1',
      });

      expect(result.id).toBe('emp-1');
    });
  });

  describe('findAll', () => {
    it('returns paginated employees for a tenant', async () => {
      const employees = [{ id: 'emp-1', nid: null, department: null, designation: null, user: null }];
      db.employee.findMany.mockResolvedValue(employees);
      db.employee.count.mockResolvedValue(1);

      const result = await service.findAll('t1');

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('applies search filter to query', async () => {
      db.employee.findMany.mockResolvedValue([]);
      db.employee.count.mockResolvedValue(0);

      await service.findAll('t1', { search: 'alice' });

      expect(db.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.objectContaining({ contains: 'alice' }) }),
            ]),
          }),
        }),
      );
    });

    it('applies status filter to query', async () => {
      db.employee.findMany.mockResolvedValue([]);
      db.employee.count.mockResolvedValue(0);

      await service.findAll('t1', { status: 'ACTIVE' });

      expect(db.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('applies departmentId filter to query', async () => {
      db.employee.findMany.mockResolvedValue([]);
      db.employee.count.mockResolvedValue(0);

      await service.findAll('t1', { departmentId: 'dept-1' });

      expect(db.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ department_id: 'dept-1' }),
        }),
      );
    });

    it('caps limit at 100', async () => {
      db.employee.findMany.mockResolvedValue([]);
      db.employee.count.mockResolvedValue(0);

      await service.findAll('t1', { limit: 500 });

      expect(db.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('returns correct pagination metadata for second page', async () => {
      db.employee.findMany.mockResolvedValue([]);
      db.employee.count.mockResolvedValue(50);

      const result = await service.findAll('t1', { page: 2, limit: 20 });

      expect(result.page).toBe(2);
      expect(result.total).toBe(50);
      expect(db.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('decrypts NID for each returned employee', async () => {
      db.employee.findMany.mockResolvedValue([
        { id: 'emp-1', nid: 'enc:987654321', department: null, designation: null, user: null },
      ]);
      db.employee.count.mockResolvedValue(1);

      const result = await service.findAll('t1');

      expect(encryption.decrypt).toHaveBeenCalledWith('enc:987654321');
      expect(result.items[0].nid).toBe('987654321');
    });
  });

  describe('findOne', () => {
    it('returns the employee when found', async () => {
      db.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        name: 'Alice',
        nid: null,
        department: null,
        designation: null,
        user: null,
      });

      const result = await service.findOne('t1', 'emp-1');

      expect(result.id).toBe('emp-1');
    });

    it('throws NotFoundException when employee not found', async () => {
      db.employee.findFirst.mockResolvedValue(null);

      await expect(service.findOne('t1', 'emp-999')).rejects.toThrow(NotFoundException);
    });

    it('decrypts NID of found employee', async () => {
      db.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        nid: 'enc:111111',
        department: null,
        designation: null,
        user: null,
      });

      const result = await service.findOne('t1', 'emp-1');

      expect(encryption.decrypt).toHaveBeenCalledWith('enc:111111');
      expect(result.nid).toBe('111111');
    });
  });

  describe('update', () => {
    const existingEmployee = {
      id: 'emp-1',
      phone: '01700000000',
      nid: null,
      tenant_id: 't1',
    };

    it('updates employee successfully', async () => {
      db.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      db.employee.update.mockResolvedValue({
        ...existingEmployee,
        name: 'Alice Updated',
        nid: null,
        department: null,
        designation: null,
        user: null,
      });

      const result = await service.update('t1', 'emp-1', { name: 'Alice Updated' } as any);

      expect(result.name).toBe('Alice Updated');
    });

    it('throws NotFoundException when employee not found', async () => {
      db.employee.findFirst.mockResolvedValue(null);

      await expect(service.update('t1', 'emp-999', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when new phone is a duplicate of another employee', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce(existingEmployee) // find employee
        .mockResolvedValueOnce({ id: 'emp-2' }); // duplicate phone check

      await expect(
        service.update('t1', 'emp-1', { phone: '01711111111' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not perform phone duplicate check when phone is unchanged', async () => {
      db.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      db.employee.update.mockResolvedValue({
        ...existingEmployee,
        nid: null,
        department: null,
        designation: null,
        user: null,
      });

      await service.update('t1', 'emp-1', { phone: existingEmployee.phone } as any);

      // findFirst should only be called once (for finding the employee itself)
      expect(db.employee.findFirst).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when updated department_id is invalid', async () => {
      db.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      db.department.findFirst.mockResolvedValue(null);

      await expect(
        service.update('t1', 'emp-1', { department_id: 'bad-dept' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when updated designation_id is invalid', async () => {
      db.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      db.department.findFirst.mockResolvedValue({ id: 'dept-1' });
      db.designation.findFirst.mockResolvedValue(null);

      await expect(
        service.update('t1', 'emp-1', { department_id: 'dept-1', designation_id: 'bad-desig' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('encrypts NID when updating with a new NID value', async () => {
      db.employee.findFirst.mockResolvedValueOnce(existingEmployee);
      db.employee.update.mockResolvedValue({
        ...existingEmployee,
        nid: 'enc:999',
        department: null,
        designation: null,
        user: null,
      });

      await service.update('t1', 'emp-1', { nid: '999' } as any);

      expect(encryption.encrypt).toHaveBeenCalledWith('999');
    });
  });

  describe('remove', () => {
    it('soft-deletes an employee successfully', async () => {
      db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      db.employee.update.mockResolvedValue({ id: 'emp-1', deleted_at: new Date() });

      const result = await service.remove('t1', 'emp-1');

      expect(db.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: null }),
        }),
      );
      expect(result.deleted_at).toBeDefined();
    });

    it('throws NotFoundException when employee not found', async () => {
      db.employee.findFirst.mockResolvedValue(null);

      await expect(service.remove('t1', 'emp-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('linkUser', () => {
    it('links a user to an employee', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce({ id: 'emp-1', tenant_id: 't1' }) // find employee
        .mockResolvedValueOnce(null); // no already-linked check
      db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 't1', user_id: 'u1' });
      db.employee.update.mockResolvedValue({
        id: 'emp-1',
        user_id: 'u1',
        nid: null,
        department: null,
        designation: null,
        user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
      });

      const result = await service.linkUser('t1', 'emp-1', 'u1');

      expect(result.user_id).toBe('u1');
    });

    it('throws NotFoundException when employee not found', async () => {
      db.employee.findFirst.mockResolvedValue(null);

      await expect(service.linkUser('t1', 'emp-999', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user does not belong to tenant', async () => {
      db.employee.findFirst.mockResolvedValueOnce({ id: 'emp-1' });
      db.tenantUser.findFirst.mockResolvedValue(null);

      await expect(service.linkUser('t1', 'emp-1', 'u-other')).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when user is already linked to another employee', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce({ id: 'emp-1' }) // find employee
        .mockResolvedValueOnce({ id: 'emp-2', user_id: 'u1' }); // already linked to different emp
      db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 't1', user_id: 'u1' });

      await expect(service.linkUser('t1', 'emp-1', 'u1')).rejects.toThrow(ConflictException);
    });

    it('allows re-linking the same user to the same employee (idempotent)', async () => {
      db.employee.findFirst
        .mockResolvedValueOnce({ id: 'emp-1' })
        .mockResolvedValueOnce({ id: 'emp-1', user_id: 'u1' }); // already linked to SAME emp
      db.tenantUser.findFirst.mockResolvedValue({ tenant_id: 't1', user_id: 'u1' });
      db.employee.update.mockResolvedValue({
        id: 'emp-1',
        user_id: 'u1',
        nid: null,
        department: null,
        designation: null,
        user: null,
      });

      const result = await service.linkUser('t1', 'emp-1', 'u1');

      expect(result.user_id).toBe('u1');
    });
  });

  describe('unlinkUser', () => {
    it('unlinks a user from an employee', async () => {
      db.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      db.employee.update.mockResolvedValue({
        id: 'emp-1',
        user_id: null,
        nid: null,
        department: null,
        designation: null,
        user: null,
      });

      const result = await service.unlinkUser('t1', 'emp-1');

      expect(db.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { user_id: null },
        }),
      );
      expect(result.user_id).toBeNull();
    });

    it('throws NotFoundException when employee not found', async () => {
      db.employee.findFirst.mockResolvedValue(null);

      await expect(service.unlinkUser('t1', 'emp-999')).rejects.toThrow(NotFoundException);
    });
  });
});
