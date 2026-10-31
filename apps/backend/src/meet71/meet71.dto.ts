import { Equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class MintMeet71SsoCodeDto {
    @IsString()
    @IsNotEmpty()
    return_url: string;

    @IsString()
    @IsNotEmpty()
    code_challenge: string;

    @Equals('S256')
    code_challenge_method: 'S256';

    @IsString()
    @IsNotEmpty()
    state: string;
}

export class ExchangeMeet71SsoDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    code_verifier: string;

    @IsString()
    @IsNotEmpty()
    return_url: string;
}

export class GoogleUpsertDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    displayName?: string;
}

export class CreateMeet71RoomDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsEmail()
    createdByEmail: string;
}

export class PatchMeet71RoomDto {
    @IsEmail()
    createdByEmail: string;
}

export class AddMeet71AllowlistDto {
    @IsString()
    @IsNotEmpty()
    pattern: string;
}

export class PatchMeet71MemberDto {
    @IsOptional()
    @IsBoolean()
    canCreateRoom?: boolean;

    @IsOptional()
    @IsInt()
    inviteQuota?: number;

    @IsOptional()
    @IsBoolean()
    isAdmin?: boolean;
}
