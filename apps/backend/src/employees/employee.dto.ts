import {
    IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsDateString, IsNumber, Min, Max, Matches,
    IsBoolean, IsInt, MaxLength, IsNotEmpty, IsArray, ArrayMaxSize, ValidateNested, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum EmployeeStatusDto {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE',
}

export class CreateEmployeeDto {
    @IsString()
    name: string;

    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    nid?: string;

    @IsOptional()
    @IsDateString()
    date_of_joining?: string;

    @IsOptional()
    @IsUUID()
    department_id?: string;

    @IsOptional()
    @IsUUID()
    designation_id?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    basic_salary?: number;

    @IsOptional()
    @IsEnum(EmployeeStatusDto)
    status?: EmployeeStatusDto;

    @IsUUID()
    storeId: string;
}

export class UpdateEmployeeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    nid?: string;

    @IsOptional()
    @IsDateString()
    date_of_joining?: string;

    @IsOptional()
    @IsUUID()
    department_id?: string;

    @IsOptional()
    @IsUUID()
    designation_id?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    basic_salary?: number;

    @IsOptional()
    @IsEnum(EmployeeStatusDto)
    status?: EmployeeStatusDto;

    @IsOptional()
    @IsUUID()
    storeId?: string;
}

/**
 * A code such as `IMP` or `IMP-04`: letters, digits, `-`, `_`, `.` and `/`.
 * Compared case-insensitively — the service stores it upper-case. The pattern
 * also admits an empty string, which clears the code.
 */
const CODE_MESSAGE = 'Code may contain only letters, numbers, "-", "_", "." and "/".';

export class CreateDepartmentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    /** Empty string or null clears it. */
    @IsOptional()
    @IsString()
    @MaxLength(30)
    @Matches(/^$|^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, { message: CODE_MESSAGE })
    code?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reports_to?: string | null;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class UpdateDepartmentDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    @Matches(/^$|^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, { message: CODE_MESSAGE })
    code?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reports_to?: string | null;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class CreateDesignationDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    @Matches(/^$|^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, { message: CODE_MESSAGE })
    code?: string | null;

    @IsOptional()
    @IsUUID()
    department_id?: string | null;

    @IsOptional()
    @IsUUID()
    level_id?: string | null;

    @IsOptional()
    @IsUUID()
    reports_to_id?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reports_to_note?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    remarks?: string | null;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class UpdateDesignationDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    @Matches(/^$|^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, { message: CODE_MESSAGE })
    code?: string | null;

    @IsOptional()
    @IsUUID()
    department_id?: string | null;

    @IsOptional()
    @IsUUID()
    level_id?: string | null;

    @IsOptional()
    @IsUUID()
    reports_to_id?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reports_to_note?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    remarks?: string | null;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class CreateDesignationLevelDto {
    @IsInt()
    @Min(1)
    @Max(99)
    level: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class UpdateDesignationLevelDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(99)
    level?: number;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

// ── Workbook import ───────────────────────────────────────────────────────────
//
// The browser reads the workbook and maps each sheet's headers to these keys;
// every value arrives as text because that is what a spreadsheet cell is. The
// service does the trimming, number parsing and cross-sheet resolution.

export class OrgImportLevelRowDto {
    @IsOptional() level?: unknown;
    @IsOptional() name?: unknown;
    @IsOptional() status?: unknown;
}

export class OrgImportDepartmentRowDto {
    @IsOptional() code?: unknown;
    @IsOptional() name?: unknown;
    @IsOptional() description?: unknown;
    @IsOptional() reports_to?: unknown;
    @IsOptional() status?: unknown;
}

export class OrgImportDesignationRowDto {
    @IsOptional() code?: unknown;
    @IsOptional() name?: unknown;
    @IsOptional() department_code?: unknown;
    @IsOptional() department_name?: unknown;
    @IsOptional() level?: unknown;
    @IsOptional() level_name?: unknown;
    @IsOptional() reports_to_code?: unknown;
    @IsOptional() reports_to_name?: unknown;
    @IsOptional() remarks?: unknown;
    @IsOptional() status?: unknown;
}

export class OrgStructureImportDto {
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => OrgImportLevelRowDto)
    levels?: OrgImportLevelRowDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(1000)
    @ValidateNested({ each: true })
    @Type(() => OrgImportDepartmentRowDto)
    departments?: OrgImportDepartmentRowDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5000)
    @ValidateNested({ each: true })
    @Type(() => OrgImportDesignationRowDto)
    designations?: OrgImportDesignationRowDto[];

    /** `skip` leaves records that already exist alone; `upsert` overwrites them from the file. */
    @IsIn(['skip', 'upsert'])
    mode: 'skip' | 'upsert';

    /** Check the file and report what would change, without writing anything. */
    @IsOptional()
    @IsBoolean()
    dry_run?: boolean;
}

export class LinkUserDto {
    @IsUUID()
    user_id: string;
}
