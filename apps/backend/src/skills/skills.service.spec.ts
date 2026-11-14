import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SkillsService } from './skills.service';
import { DatabaseService } from '../database/database.service';

describe('SkillsService', () => {
    let service: SkillsService;
    let db: any;

    beforeEach(async () => {
        db = {
            skill: {
                findMany: jest.fn(),
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            personSkill: {
                findFirst: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                deleteMany: jest.fn(),
                count: jest.fn(),
            },
            projectSkill: {
                count: jest.fn(),
            },
            employee: {
                findFirst: jest.fn(),
            },
            tenantUser: {
                findFirst: jest.fn(),
            },
        };

        const module = await Test.createTestingModule({
            providers: [
                SkillsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();
        service = module.get(SkillsService);
        jest.clearAllMocks();
    });

    describe('list', () => {
        it('returns skills for a tenant, active first by sort then name', async () => {
            const rows = [{ id: 's1', name: 'Welding' }];
            db.skill.findMany.mockResolvedValue(rows);

            await expect(service.list('t1')).resolves.toEqual(rows);
            expect(db.skill.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { tenant_id: 't1', deleted_at: null },
                orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            }));
        });
    });

    describe('create', () => {
        it('creates a skill when the name is unique', async () => {
            db.skill.findFirst.mockResolvedValue(null);
            db.skill.create.mockResolvedValue({ id: 's1', name: 'Welding' });

            const result = await service.create('t1', { name: 'Welding' });

            expect(result.id).toBe('s1');
            expect(db.skill.create).toHaveBeenCalledWith({
                data: {
                    tenant_id: 't1',
                    name: 'Welding',
                    description: null,
                    category: 'OTHER',
                    is_active: true,
                    sort_order: 0,
                },
                include: expect.any(Object),
            });
        });

        it('throws ConflictException when the name already exists', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', name: 'Welding' });

            await expect(service.create('t1', { name: 'Welding' })).rejects.toThrow(ConflictException);
        });

        it('revives a deleted skill of the same name', async () => {
            db.skill.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 's-old' });
            db.skill.update.mockResolvedValue({ id: 's-old', name: 'Welding', deleted_at: null });

            const result = await service.create('t1', { name: 'Welding' });

            expect(result.id).toBe('s-old');
            expect(db.skill.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 's-old' },
                data: expect.objectContaining({ name: 'Welding', deleted_at: null }),
            }));
        });
    });

    describe('remove', () => {
        it('soft-deletes an unused skill', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', name: 'Welding' });
            db.personSkill.count.mockResolvedValue(0);
            db.projectSkill.count.mockResolvedValue(0);
            db.skill.update.mockResolvedValue({ id: 's1', deleted_at: new Date() });

            await service.remove('t1', 's1');

            expect(db.skill.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 's1' },
                data: expect.objectContaining({ deleted_at: expect.any(Date) }),
            }));
        });

        it('refuses to delete a skill still on people or projects', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1' });
            db.personSkill.count.mockResolvedValue(1);
            db.projectSkill.count.mockResolvedValue(0);

            await expect(service.remove('t1', 's1')).rejects.toThrow(BadRequestException);
            expect(db.skill.update).not.toHaveBeenCalled();
        });
    });

    describe('assignPerson', () => {
        it('refuses when neither employee nor user is named', async () => {
            await expect(service.assignPerson('t1', { skillId: 's1' } as never))
                .rejects.toThrow(BadRequestException);
        });

        it('stores both employee_id and user_id when the employee has a login', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', is_active: true });
            db.employee.findFirst.mockResolvedValue({ id: 'e1', user_id: 'u1' });
            db.personSkill.findFirst.mockResolvedValue(null);
            db.personSkill.create.mockResolvedValue({ id: 'ps1' });

            await service.assignPerson('t1', { skillId: 's1', employeeId: 'e1', proficiency: 'ADVANCED' });

            expect(db.personSkill.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    tenant_id: 't1',
                    skill_id: 's1',
                    employee_id: 'e1',
                    user_id: 'u1',
                    proficiency: 'ADVANCED',
                }),
            }));
        });

        it('updates an existing assignment instead of duplicating it', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', is_active: true });
            db.employee.findFirst.mockResolvedValue({ id: 'e1', user_id: null });
            db.personSkill.findFirst.mockResolvedValue({ id: 'ps1' });
            db.personSkill.update.mockResolvedValue({ id: 'ps1' });

            await service.assignPerson('t1', { skillId: 's1', employeeId: 'e1', proficiency: 'EXPERT' });

            expect(db.personSkill.create).not.toHaveBeenCalled();
            expect(db.personSkill.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'ps1' },
                data: expect.objectContaining({ proficiency: 'EXPERT', employee_id: 'e1' }),
            }));
        });

        it('assigns to a workspace user with no employee record', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', is_active: true });
            db.tenantUser.findFirst.mockResolvedValue({ user_id: 'u1' });
            db.employee.findFirst.mockResolvedValue(null);
            db.personSkill.findFirst.mockResolvedValue(null);
            db.personSkill.create.mockResolvedValue({ id: 'ps1' });

            await service.assignPerson('t1', { skillId: 's1', userId: 'u1' });

            expect(db.personSkill.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ employee_id: null, user_id: 'u1' }),
            }));
        });

        it('refuses an inactive skill', async () => {
            db.skill.findFirst.mockResolvedValue({ id: 's1', is_active: false });

            await expect(service.assignPerson('t1', { skillId: 's1', employeeId: 'e1' }))
                .rejects.toThrow(BadRequestException);
        });
    });

    describe('removePerson', () => {
        it('deletes the assignment in the tenant', async () => {
            db.personSkill.deleteMany.mockResolvedValue({ count: 1 });
            await expect(service.removePerson('t1', 'ps1')).resolves.toEqual({ success: true });
        });

        it('404s when the assignment is missing', async () => {
            db.personSkill.deleteMany.mockResolvedValue({ count: 0 });
            await expect(service.removePerson('t1', 'ps1')).rejects.toThrow(NotFoundException);
        });
    });
});
