import { IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsDateString, Matches } from 'class-validator';

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
    @IsEnum(EmployeeStatusDto)
    status?: EmployeeStatusDto;
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
    @IsEnum(EmployeeStatusDto)
    status?: EmployeeStatusDto;
}

export class CreateDepartmentDto {
    @IsString()
    name: string;
}

export class CreateDesignationDto {
    @IsString()
    name: string;
}

export class LinkUserDto {
    @IsUUID()
    user_id: string;
}
