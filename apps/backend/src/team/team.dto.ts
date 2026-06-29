import { IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { StorePermission, UserRole } from '@erp71/shared-types';

const STORE_PERMISSION_VALUES = Object.values(StorePermission) as string[];

export class InviteMemberDto {
    @IsEmail()
    email: string;

    @IsEnum(UserRole)
    role: UserRole;
}

export class UpdateRoleDto {
    @IsEnum(UserRole)
    role: UserRole;

    /** When true, reset each accessible branch's permissions to the new role's defaults. */
    @IsOptional()
    @IsBoolean()
    reseedPermissions?: boolean;
}

export class GrantStoreAccessDto {
    @IsString()
    storeId: string;

    @IsIn(['STORE_ONLY', 'MULTI_STORE_CAPABLE'])
    accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE';

    /** Seed the role's default permissions when first granting access. Defaults to true. */
    @IsOptional()
    @IsBoolean()
    seedDefaults?: boolean;
}

export class SetStorePermissionsDto {
    @IsArray()
    @IsIn(STORE_PERMISSION_VALUES, { each: true })
    permissions: StorePermission[];
}
