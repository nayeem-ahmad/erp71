import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class SubmitNpsDto {
    @IsInt()
    @Min(0)
    @Max(10)
    score: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    comment?: string;
}

/** An owner's answer to the in-app question, or `dismissed` to close it unanswered. */
export class SubmitPlatformNpsDto {
    @IsOptional()
    @IsBoolean()
    dismissed?: boolean;

    @ValidateIf((dto: SubmitPlatformNpsDto) => !dto.dismissed)
    @IsInt()
    @Min(0)
    @Max(10)
    score?: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    comment?: string;
}
