import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { StorePermission } from '@erp71/shared-types';

const STORE_PERMISSION_VALUES = Object.values(StorePermission) as string[];

export class InviteMemberDto {
    @IsEmail()
    email: string;

    /**
     * Single-role form kept for callers that predate multi-role invites. Ignored
     * when `tenantRoleIds` is given; one of the two is required.
     */
    @IsOptional()
    @IsString()
    tenantRoleId?: string;

    /** Every role the invitee will hold. Their access is the union of all of them. */
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    tenantRoleIds?: string[];
}

export class UpdateRoleDto {
    /** Single-role form. Ignored when `tenantRoleIds` is given; one of the two is required. */
    @IsOptional()
    @IsString()
    tenantRoleId?: string;

    /**
     * The member's whole role set, primary first. Their permissions become the
     * union of every role listed.
     */
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    tenantRoleIds?: string[];
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

export class CreateTenantRoleDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsArray()
    @IsIn(STORE_PERMISSION_VALUES, { each: true })
    permissions: StorePermission[];
}

export class UpdateTenantRoleDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsArray()
    @IsIn(STORE_PERMISSION_VALUES, { each: true })
    permissions?: StorePermission[];
}
