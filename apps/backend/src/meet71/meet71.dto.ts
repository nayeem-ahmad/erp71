import {
    ArrayMaxSize,
    Equals,
    IsArray,
    IsBoolean,
    IsEmail,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';

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
    @IsOptional()
    @IsEmail()
    createdByEmail?: string;

    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    @ArrayMaxSize(10)
    coHostEmails?: string[];
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

export class InviteMeet71Dto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsBoolean()
    resend?: boolean;
}

export class InternalInviteMeet71Dto extends InviteMeet71Dto {
    @IsEmail()
    actorEmail: string;
}

export class StartMeet71CallDto {
    @IsEmail()
    to: string;

    @IsOptional()
    @IsIn(['voice', 'video'])
    mode?: 'voice' | 'video';
}
