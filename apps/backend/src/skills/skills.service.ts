import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { CreateSkillDto, UpdateSkillDto, AssignPersonSkillDto, UpdatePersonSkillDto } from './skill.dto';

const SKILL_COUNT = {
    _count: {
        select: {
            personSkills: true,
            projectSkills: true,
        },
    },
} as const;

const PERSON_SKILL_INCLUDE = {
    skill: { select: { id: true, name: true, category: true, is_active: true } },
    employee: { select: { id: true, name: true, employee_code: true, user_id: true } },
    user: { select: { id: true, name: true, email: true } },
} as const;

function activeFilter(status?: string): { is_active?: boolean } {
    if (status === 'active') return { is_active: true };
    if (status === 'inactive') return { is_active: false };
    return {};
}

function cleanText(value: unknown): string | null {
    if (value == null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

@Injectable()
export class SkillsService {
    constructor(private readonly db: DatabaseService) {}

    async list(tenantId: string, opts: { status?: string } = {}) {
        return this.db.skill.findMany({
            where: { tenant_id: tenantId, deleted_at: null, ...activeFilter(opts.status) },
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
            include: SKILL_COUNT,
        });
    }

    async create(tenantId: string, dto: CreateSkillDto) {
        const name = dto.name.trim();
        await this.assertNameUnique(tenantId, name);

        const data = {
            name,
            description: cleanText(dto.description),
            category: dto.category ?? 'OTHER',
            is_active: dto.is_active ?? true,
            sort_order: dto.sort_order ?? 0,
        } as const;

        const deleted = await this.db.skill.findFirst({
            where: { tenant_id: tenantId, name, NOT: { deleted_at: null } },
            select: { id: true },
        });
        if (deleted) {
            return this.db.skill.update({
                where: { id: deleted.id },
                data: { ...data, deleted_at: null },
                include: SKILL_COUNT,
            });
        }
        return this.db.skill.create({
            data: { tenant_id: tenantId, ...data },
            include: SKILL_COUNT,
        });
    }

    async update(tenantId: string, id: string, dto: UpdateSkillDto) {
        const skill = await this.requireSkill(tenantId, id);
        const name = dto.name !== undefined ? dto.name.trim() : undefined;
        if (name !== undefined && name !== skill.name) {
            await this.assertNameUnique(tenantId, name, id);
        }

        return this.db.skill.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(dto.description !== undefined ? { description: cleanText(dto.description) } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
                ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
            },
            include: SKILL_COUNT,
        });
    }

    async remove(tenantId: string, id: string) {
        const skill = await this.requireSkill(tenantId, id);
        const [people, projects] = await Promise.all([
            this.db.personSkill.count({ where: { skill_id: id } }),
            this.db.projectSkill.count({ where: { skill_id: id } }),
        ]);
        if (people > 0 || projects > 0) {
            throw new BadRequestException('This skill is still in use.');
        }
        return this.db.skill.update({
            where: { id: skill.id },
            data: { deleted_at: new Date() },
        });
    }

    async assignPerson(tenantId: string, dto: AssignPersonSkillDto) {
        if (!dto.employeeId && !dto.userId) {
            throw new BadRequestException('Pick the person to add the skill to.');
        }

        const skill = await this.requireSkill(tenantId, dto.skillId);
        if (skill.is_active === false) {
            throw new BadRequestException('This skill is inactive.');
        }

        const { employeeId, userId } = await this.resolvePerson(tenantId, dto.employeeId, dto.userId);
        const existing = await this.findPersonSkill(tenantId, skill.id, employeeId, userId);
        const payload = {
            proficiency: dto.proficiency ?? 'INTERMEDIATE',
            notes: cleanText(dto.notes),
            employee_id: employeeId,
            user_id: userId,
        };

        if (existing) {
            return this.db.personSkill.update({
                where: { id: existing.id },
                data: payload,
                include: PERSON_SKILL_INCLUDE,
            });
        }

        try {
            return await this.db.personSkill.create({
                data: {
                    tenant_id: tenantId,
                    skill_id: skill.id,
                    ...payload,
                },
                include: PERSON_SKILL_INCLUDE,
            });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new ConflictException('This person already has that skill.');
            }
            throw err;
        }
    }

    async updatePerson(tenantId: string, id: string, dto: UpdatePersonSkillDto) {
        const row = await this.db.personSkill.findFirst({ where: { id, tenant_id: tenantId } });
        if (!row) throw new NotFoundException('Skill assignment not found.');
        return this.db.personSkill.update({
            where: { id },
            data: {
                ...(dto.proficiency !== undefined ? { proficiency: dto.proficiency } : {}),
                ...(dto.notes !== undefined ? { notes: cleanText(dto.notes) } : {}),
            },
            include: PERSON_SKILL_INCLUDE,
        });
    }

    async removePerson(tenantId: string, id: string) {
        const result = await this.db.personSkill.deleteMany({ where: { id, tenant_id: tenantId } });
        if (result.count === 0) throw new NotFoundException('Skill assignment not found.');
        return { success: true };
    }

    private async requireSkill(tenantId: string, id: string) {
        const skill = await this.db.skill.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!skill) throw new NotFoundException('Skill not found.');
        return skill;
    }

    private async assertNameUnique(tenantId: string, name: string, exceptId?: string) {
        const duplicate = await this.db.skill.findFirst({
            where: {
                tenant_id: tenantId,
                name: { equals: name, mode: 'insensitive' },
                deleted_at: null,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
            },
        });
        if (duplicate) throw new ConflictException('A skill with this name already exists.');
    }

    /**
     * An employee linked to a login is one person: store both ids so a project
     * member keyed as a user still sees the same skills.
     */
    private async resolvePerson(
        tenantId: string,
        employeeId?: string,
        userId?: string,
    ): Promise<{ employeeId: string | null; userId: string | null }> {
        if (employeeId) {
            const employee = await this.db.employee.findFirst({
                where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, user_id: true },
            });
            if (!employee) throw new BadRequestException('That employee is not in this workspace.');
            if (userId && employee.user_id && userId !== employee.user_id) {
                throw new BadRequestException('That user is not linked to this employee.');
            }
            return { employeeId: employee.id, userId: employee.user_id ?? userId ?? null };
        }

        const member = await this.db.tenantUser.findFirst({
            where: { tenant_id: tenantId, user_id: userId },
            select: { user_id: true },
        });
        if (!member) throw new BadRequestException('That user is not part of this workspace.');

        const employee = await this.db.employee.findFirst({
            where: { tenant_id: tenantId, user_id: userId, deleted_at: null },
            select: { id: true },
        });
        return { employeeId: employee?.id ?? null, userId: userId ?? null };
    }

    private async findPersonSkill(
        tenantId: string,
        skillId: string,
        employeeId: string | null,
        userId: string | null,
    ) {
        const or: Prisma.PersonSkillWhereInput[] = [];
        if (employeeId) or.push({ employee_id: employeeId });
        if (userId) or.push({ user_id: userId });
        if (or.length === 0) return null;
        return this.db.personSkill.findFirst({
            where: { tenant_id: tenantId, skill_id: skillId, OR: or },
        });
    }
}
