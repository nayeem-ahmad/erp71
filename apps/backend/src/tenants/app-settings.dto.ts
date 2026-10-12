import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class UpdateAppSettingsDto {
    /** The whole hidden list; ids are checked against `APP_REGISTRY` in the service. */
    @IsArray()
    @ArrayMaxSize(32)
    @IsString({ each: true })
    hidden_apps!: string[];
}
