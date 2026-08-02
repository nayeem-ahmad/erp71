import { Transform } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsEmail,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateIf,
} from 'class-validator';

/** Mirrors the Prisma `CrmContactCaptureSource` enum — Prisma enums are types only at runtime. */
export enum CrmContactCaptureSource {
    MANUAL = 'MANUAL',
    BUSINESS_CARD = 'BUSINESS_CARD',
    IMPORT = 'IMPORT',
}

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

/**
 * Validate a format-checked field only when it actually holds something.
 *
 * The obvious spelling — `@Transform(emptyToUndefined)` — collapses a cleared
 * field to `undefined`, which the service reads as "leave it alone". That makes
 * an email or an owner **unclearable once set**, which matters most right after
 * a card scan puts a misread address into the form. `@IsOptional()` alone does
 * not help: it skips `undefined` and `null`, not `''`.
 */
const skipWhenBlank = (o: { [key: string]: unknown }, key: string) => o[key] !== '';

export class CreateContactDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    company?: string;

    @IsOptional()
    @IsString()
    designation?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @ValidateIf((o) => skipWhenBlank(o, 'email'))
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    /**
     * Set by the client only when the row came off a scanned card. Everything
     * else is left to the column default, so an ordinary create cannot dress
     * itself up as OCR output by accident.
     */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(CrmContactCaptureSource)
    capture_source?: CrmContactCaptureSource;

    @IsOptional()
    @ValidateIf((o) => skipWhenBlank(o, 'assigned_to'))
    @IsUUID()
    assigned_to?: string;
}

export class UpdateContactDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    company?: string;

    @IsOptional()
    @IsString()
    designation?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @ValidateIf((o) => skipWhenBlank(o, 'email'))
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @ValidateIf((o) => skipWhenBlank(o, 'assigned_to'))
    @IsUUID()
    assigned_to?: string;
}

export class ListContactsDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    search?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    company?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    assignedTo?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(CrmContactCaptureSource)
    captureSource?: CrmContactCaptureSource;

    @IsOptional()
    @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    limit?: number;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    sortBy?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    sortDir?: string;
}

export enum ContactBulkAction {
    DELETE = 'delete',
    ASSIGN = 'assign',
}

export class BulkContactActionDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    ids: string[];

    @IsEnum(ContactBulkAction)
    action: ContactBulkAction;

    @IsOptional()
    @IsString()
    value?: string;
}

/**
 * A photographed business card, as a base64 payload.
 *
 * Deliberately not multipart: the scan itself stores nothing. The image goes to
 * the vision model and only the extracted fields come back. Keeping the card is
 * a separate, later step — see `AddContactAttachmentDto` — so an abandoned scan
 * never leaves a file behind.
 */
export class ScanBusinessCardDto {
    @IsString()
    imageBase64: string;

    /** `image/jpeg`, `image/png`, `image/webp`, or `image/heic`. Validated in the service. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;
}

/**
 * The card image kept against a saved contact.
 *
 * Sent only once the contact exists, which is what keeps storage free of
 * orphans: a scan the user walks away from was never uploaded in the first
 * place. The payload is the same downscaled JPEG the scan already sent, so this
 * costs no extra work in the browser and no second encode.
 */
export class AddContactAttachmentDto {
    /** A `data:` URL or a bare base64 string. */
    @IsString()
    imageBase64: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;

    /** Shown in the UI and used as the stored filename stem. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
