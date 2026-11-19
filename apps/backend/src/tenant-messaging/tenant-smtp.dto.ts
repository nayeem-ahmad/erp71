import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/**
 * The submission ports. Anything else is refused so the "send test" button
 * cannot be pointed at arbitrary services on the internet to see what answers.
 */
export const SMTP_PORTS = [25, 465, 587, 2525];
export const SMTP_SECURITY = ['starttls', 'ssl'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/**
 * Every field optional: omitted keeps the stored value, an empty string clears
 * it. `password` follows the same rule, and the mask the GET returns also means
 * "keep the stored one".
 */
export class UpdateTenantSmtpServerDto {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    /** A hostname or IP literal; no scheme, path or port. */
    @IsOptional()
    @ValidateIf((_, value) => value !== '')
    @IsString()
    @MaxLength(253)
    @Matches(/^[A-Za-z0-9.\-:\[\]]+$/, { message: 'Enter just the server name, e.g. smtp.gmail.com.' })
    host?: string;

    @IsOptional()
    @IsInt()
    @IsIn(SMTP_PORTS, { message: `Port must be one of ${SMTP_PORTS.join(', ')}.` })
    port?: number;

    @IsOptional()
    @IsIn(SMTP_SECURITY as unknown as string[])
    security?: SmtpSecurity;

    @IsOptional()
    @IsString()
    @MaxLength(254)
    username?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    password?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== '')
    @IsEmail({}, { message: 'Enter a valid from-address.' })
    from_email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    from_name?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== '')
    @IsEmail({}, { message: 'Enter a valid reply-to address.' })
    reply_to?: string;
}

export class TestTenantSmtpServerDto {
    /** Defaults to the signed-in member's own address. */
    @IsOptional()
    @IsEmail({}, { message: 'Enter a valid email address to send the test to.' })
    to?: string;
}
