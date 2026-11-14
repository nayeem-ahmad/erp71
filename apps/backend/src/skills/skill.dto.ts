import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
    PROJECT_SKILL_REQUIREMENT_VALUES,
    SKILL_CATEGORY_VALUES,
    SKILL_PROFICIENCY_VALUES,
    type ProjectSkillRequirement,
    type SkillCategory,
    type SkillProficiency,
} from '@erp71/shared-types';

export class CreateSkillDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsIn(SKILL_CATEGORY_VALUES)
    category?: SkillCategory;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(9999)
    sort_order?: number;
}

export class UpdateSkillDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsIn(SKILL_CATEGORY_VALUES)
    category?: SkillCategory;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(9999)
    sort_order?: number;
}

export class AssignPersonSkillDto {
    @IsOptional()
    @IsUUID()
    employeeId?: string;

    @IsOptional()
    @IsUUID()
    userId?: string;

    @IsUUID()
    skillId: string;

    @IsOptional()
    @IsIn(SKILL_PROFICIENCY_VALUES)
    proficiency?: SkillProficiency;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string | null;
}

export class UpdatePersonSkillDto {
    @IsOptional()
    @IsIn(SKILL_PROFICIENCY_VALUES)
    proficiency?: SkillProficiency;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string | null;
}

export class AssignProjectSkillDto {
    @IsUUID()
    skillId: string;

    @IsOptional()
    @IsIn(PROJECT_SKILL_REQUIREMENT_VALUES)
    requirement?: ProjectSkillRequirement;

    @IsOptional()
    @IsIn(SKILL_PROFICIENCY_VALUES)
    minProficiency?: SkillProficiency | null;
}

export class UpdateProjectSkillDto {
    @IsOptional()
    @IsIn(PROJECT_SKILL_REQUIREMENT_VALUES)
    requirement?: ProjectSkillRequirement;

    @IsOptional()
    @IsIn(SKILL_PROFICIENCY_VALUES)
    minProficiency?: SkillProficiency | null;
}
