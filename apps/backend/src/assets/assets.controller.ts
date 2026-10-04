import {
    Controller,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
    UseGuards,
    BadRequestException,
    ForbiddenException,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { hasAnyStorePermission } from '../auth/permission.util';
import { UPLOAD_PURPOSES, UPLOAD_PURPOSE_NAMES, isUploadPurpose, type UploadPurpose } from './upload-purposes';

export class UploadSignatureDto {
    @IsIn(UPLOAD_PURPOSE_NAMES)
    purpose!: UploadPurpose;
}

@Controller('assets')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class AssetsController {
    constructor(
        private readonly assetsService: AssetsService,
        private readonly db: DatabaseService,
    ) { }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @Tenant() tenant: TenantContext,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const fileName = `${tenant.tenantId}/${Date.now()}-${file.originalname}`;
        const url = await this.assetsService.uploadFile(file, fileName);

        return { url };
    }

    /**
     * Sign one browser upload straight to Cloudinary, so the file skips the
     * Bangladesh → API → Cloudinary detour (see `direct-upload.util.ts`).
     *
     * The folder is the tenant's (or, for an avatar, the user's) folder for
     * `purpose`, and it is inside the signature: the browser cannot point the
     * upload anywhere else without Cloudinary refusing it.
     *
     * Open at the route because one route serves every purpose; the permission
     * each purpose needs is the one its save route needs, checked here.
     * Throttled tighter than the default: one signature covers a whole batch,
     * so a person needs only a handful a minute, and each one is an hour's
     * licence to upload.
     */
    @Post('upload-signature')
    @HttpCode(HttpStatus.OK)
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    async uploadSignature(@Tenant() tenant: TenantContext, @Body() dto: UploadSignatureDto) {
        // The DTO already refuses an unknown purpose; this keeps the lookup
        // below safe for callers that reach it without the validation pipe.
        if (!isUploadPurpose(dto?.purpose)) {
            throw new BadRequestException('Unknown upload purpose.');
        }
        const rule = UPLOAD_PURPOSES[dto.purpose];

        if (rule.permissions && !(await hasAnyStorePermission(this.db, tenant, rule.permissions))) {
            throw new ForbiddenException(
                `Requires one of these store permissions: ${rule.permissions.join(', ')}`,
            );
        }

        return this.assetsService.signDirectUpload(
            rule.folder({ tenantId: tenant.tenantId, userId: tenant.userId }),
        );
    }
}
