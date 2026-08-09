import {
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';

const CATEGORIES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type BoardColumnCategory = (typeof CATEGORIES)[number];

export class CreateBoardDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;
}

export class UpdateBoardDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;
}

export class AddBoardTasksDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('4', { each: true })
    taskIds!: string[];
}

export class MoveBoardCardDto {
    @IsUUID()
    columnId!: string;

    @IsInt()
    @Min(0)
    sortOrder!: number;
}

export class CreateBoardColumnDto {
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name!: string;

    @IsEnum(CATEGORIES)
    category!: BoardColumnCategory;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    wipLimit?: number;
}

export class UpdateBoardColumnDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsEnum(CATEGORIES)
    category?: BoardColumnCategory;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    wipLimit?: number | null;
}

export class SetBoardColumnStatusesDto {
    /** Empty is legal: it unbinds the column entirely. */
    @IsArray()
    @IsUUID('4', { each: true })
    statusIds!: string[];
}
