import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
    /** FCM registration token. Google's are ~160 characters; leave room. */
    @IsString()
    @IsNotEmpty()
    @MaxLength(4096)
    token: string;

    @IsIn(['android', 'ios'])
    platform: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    app_version?: string;

    /** Names the session this phone is signed in with; see PushService.register. */
    @IsString()
    @IsNotEmpty()
    refresh_token: string;
}

export class UnregisterDeviceDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(4096)
    token: string;
}
