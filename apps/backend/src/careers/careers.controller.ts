import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { isApplicantScope } from '../auth/token-scope';
import { CareersJwtGuard, JobSeekerGuard } from './job-seeker.guard';
import { CareersService } from './careers.service';
import {
    CareersApplyDto,
    CareersJobQueryDto,
    CareersLoginDto,
    CareersRegisterDto,
    CareersTwoFactorDto,
    UpdateCareersProfileDto,
} from './careers.dto';

/** CVs beyond this are rejected before they reach Cloudinary. */
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * The public careers board. No authentication required — this is the front door
 * for people who do not have an account yet.
 *
 * `OptionalJwtAuthGuard` is here only so a signed-in job seeker sees which jobs
 * they have already applied to. An anonymous request is the normal case and
 * gets the same listing minus that flag.
 */
@Controller('careers')
export class CareersPublicController {
    constructor(
        private readonly service: CareersService,
        private readonly db: DatabaseService,
    ) {}

    @Get('jobs')
    @UseGuards(OptionalJwtAuthGuard)
    async listJobs(@Request() req: any, @Query() query: CareersJobQueryDto) {
        return this.service.listJobs(query, await this.optionalJobSeekerId(req));
    }

    @Get('companies')
    listCompanies() {
        return this.service.listHiringCompanies();
    }

    @Get('jobs/:id')
    @UseGuards(OptionalJwtAuthGuard)
    async getJob(@Request() req: any, @Param('id') id: string) {
        return this.service.getJob(id, await this.optionalJobSeekerId(req));
    }

    /**
     * The job-seeker id behind an optional token, or undefined.
     *
     * Scope-checked: an ERP or storefront token reaching this route is treated
     * as anonymous rather than being resolved to whatever careers profile the
     * same `User` might own, which keeps the board's behaviour identical to
     * what `JobSeekerGuard` would allow.
     */
    private async optionalJobSeekerId(req: any): Promise<string | undefined> {
        const userId = req.user?.userId;
        if (!userId || !isApplicantScope(req.user?.scope)) return undefined;

        const seeker = await this.db.jobSeeker.findFirst({
            where: { user_id: userId, deleted_at: null },
            select: { id: true },
        });
        return seeker?.id;
    }
}

/**
 * Careers sign-up and sign-in. Mints `applicant`-scoped tokens, which
 * `JwtAuthGuard` refuses — so nothing minted here can reach the ERP API.
 */
@Controller('careers/auth')
export class CareersAuthController {
    constructor(private readonly service: CareersService) {}

    @Post('register')
    @Throttle({ default: { ttl: 60_000, limit: 5 } })
    register(@Body() dto: CareersRegisterDto) {
        return this.service.register(dto);
    }

    @Post('login')
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @HttpCode(HttpStatus.OK)
    login(@Body() dto: CareersLoginDto) {
        return this.service.login(dto);
    }

    @Post('2fa/verify')
    @Throttle({ default: { ttl: 60_000, limit: 10 } })
    @HttpCode(HttpStatus.OK)
    verifyTwoFactor(@Body() dto: CareersTwoFactorDto) {
        return this.service.completeTwoFactorLogin(dto.userId, dto.code);
    }

    /**
     * Guarded by the careers pair, not `JwtAuthGuard`: the whole point is that
     * this route accepts the applicant token `JwtAuthGuard` rejects.
     */
    @Post('logout')
    @UseGuards(CareersJwtGuard, JobSeekerGuard)
    @HttpCode(HttpStatus.OK)
    async logout(@Request() req: any) {
        await this.service.logout(req.user.userId);
        return { success: true };
    }
}

/**
 * The job seeker's own screens. Every handler reads `req.jobSeeker`, populated
 * by `JobSeekerGuard` from the token — no handler takes a profile id.
 */
@Controller('careers/portal')
@UseGuards(CareersJwtGuard, JobSeekerGuard)
export class CareersPortalController {
    constructor(
        private readonly service: CareersService,
        private readonly assets: AssetsService,
    ) {}

    @Get('me')
    getProfile(@Request() req: any) {
        return this.service.getProfile(req.jobSeeker.id);
    }

    @Patch('me')
    updateProfile(@Request() req: any, @Body() dto: UpdateCareersProfileDto) {
        return this.service.updateProfile(req.jobSeeker.id, dto);
    }

    @Post('me/resume')
    @UseInterceptors(FileInterceptor('file'))
    async uploadResume(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file uploaded');
        if (file.size > MAX_RESUME_BYTES) {
            throw new BadRequestException('CV must be 5MB or smaller');
        }
        if (!ALLOWED_RESUME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException('CV must be a PDF or Word document');
        }

        // `raw`, not `image`: a PDF put through Cloudinary's image pipeline
        // comes back mangled (see AssetsService.uploadBuffer).
        const uploaded = await this.assets.uploadBuffer(
            file.buffer,
            'careers/resumes',
            file.originalname,
            'raw',
        );

        return this.service.setResume(req.jobSeeker.id, uploaded.url, file.originalname);
    }

    @Get('applications')
    listApplications(@Request() req: any) {
        return this.service.listMyApplications(req.jobSeeker.id);
    }

    @Get('applications/:id')
    getApplication(@Request() req: any, @Param('id') id: string) {
        return this.service.getMyApplication(req.jobSeeker.id, id);
    }

    @Post('jobs/:jobId/apply')
    apply(@Request() req: any, @Param('jobId') jobId: string, @Body() dto: CareersApplyDto) {
        return this.service.apply(req.jobSeeker.id, jobId, dto);
    }

    @Patch('applications/:id/withdraw')
    withdraw(@Request() req: any, @Param('id') id: string) {
        return this.service.withdraw(req.jobSeeker.id, id);
    }
}
