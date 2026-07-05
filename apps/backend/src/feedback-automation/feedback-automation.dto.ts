import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class SaveInstructionDto {
    @IsString()
    @MinLength(3)
    instruction: string;
}

export enum PlanReviewDecision {
    APPROVE = 'APPROVE',
    REQUEST_CHANGES = 'REQUEST_CHANGES',
}

export class ReviewPlanDto {
    @IsEnum(PlanReviewDecision)
    decision: PlanReviewDecision;

    @IsString()
    @IsOptional()
    comment?: string;

    /** Required when the plan is flagged hasMigration=true and require_migration_signoff is on. */
    @IsBoolean()
    @IsOptional()
    confirmMigration?: boolean;
}
