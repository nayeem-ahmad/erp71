import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Every field is optional: the admin UI PATCHes the whole card, but an operator
 * flipping only the email switch must not have to resend the WhatsApp token.
 *
 * Secret semantics for `whatsapp_access_token`: omitted (or the mask the GET
 * returns) keeps the stored token, an empty string clears it.
 */
export class UpdateTenantMessagingIdentityDto {
    @IsOptional()
    @IsBoolean()
    email_enabled?: boolean;

    /// Bare address only — the display name goes in `email_from_name`, because
    /// the Brevo API takes the two separately and would otherwise send
    /// "Shop <a@b.com>" as the literal address.
    @IsOptional()
    @ValidateIf((_, value) => value !== '')
    @IsEmail({}, { message: 'email_from must be a valid email address.' })
    email_from?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    email_from_name?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== '')
    @IsEmail({}, { message: 'email_reply_to must be a valid email address.' })
    email_reply_to?: string;

    @IsOptional()
    @IsBoolean()
    whatsapp_enabled?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    whatsapp_phone_number_id?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    whatsapp_access_token?: string;

    @IsOptional()
    @IsString()
    @MaxLength(16)
    whatsapp_api_version?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string;
}

export class TestTenantMessagingIdentityDto {
    @IsString()
    to: string;
}
