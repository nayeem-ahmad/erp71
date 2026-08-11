import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export class UploadCrmPhotoDto {
    /** A `data:` URL or a bare base64 string. */
    @IsString()
    imageBase64: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    mimeType?: string;

    /** Used as the stored filename stem only; never shown to a user. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
