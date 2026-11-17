import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Markdown, pictures included as `![name](url)` lines — a few hundred KB is
 * a very long note. The ceiling is there so one PATCH cannot park megabytes
 * of pasted base64 in a row that every list call then reads.
 */
export const MAX_NOTE_CONTENT_LENGTH = 200_000;
export const MAX_NOTE_TITLE_LENGTH = 200;

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export class CreateNoteDto {
    @IsOptional()
    @Transform(trimmed)
    @IsString()
    @MaxLength(MAX_NOTE_TITLE_LENGTH)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(MAX_NOTE_CONTENT_LENGTH)
    content?: string;

    @IsOptional()
    @IsBoolean()
    pinned?: boolean;
}

export class UpdateNoteDto extends CreateNoteDto {}

export class ListNotesQueryDto {
    /** Matches the title or the body, case-insensitively. */
    @IsOptional()
    @Transform(trimmed)
    @IsString()
    @MaxLength(100)
    search?: string;
}

/** The server-side fallback for a picture that could not go straight to Cloudinary. */
export class UploadNoteImageDto {
    /** A `data:` URL or a bare base64 string. */
    @IsString()
    imageBase64!: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;

    /** Used as the stored filename stem only. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
