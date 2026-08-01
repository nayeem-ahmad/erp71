import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PrintTemplatesService } from './print-templates.service';
import {
    CreatePrintTemplateDto,
    PrintTemplateResponseDto,
    ResolvePrintTemplateQueryDto,
    ResolvedPrintTemplateDto,
    UpdatePrintTemplateDto,
} from './print-templates.dto';

@Controller('print-templates')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PrintTemplatesController {
    constructor(private readonly printTemplatesService: PrintTemplatesService) { }

    @Get()
    async list(@Tenant() tenant: TenantContext): Promise<PrintTemplateResponseDto[]> {
        return this.printTemplatesService.list(tenant.tenantId);
    }

    /** Effective header config for a document type — what printers call. */
    @Get('resolve')
    async resolve(
        @Tenant() tenant: TenantContext,
        @Query() query: ResolvePrintTemplateQueryDto,
    ): Promise<ResolvedPrintTemplateDto> {
        return this.printTemplatesService.resolve(tenant.tenantId, query.docType);
    }

    @Get(':id')
    async get(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.get(tenant.tenantId, id);
    }

    @Post()
    async create(
        @Tenant() tenant: TenantContext,
        @Body() dto: CreatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.create(tenant.tenantId, dto);
    }

    @Patch(':id')
    async update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    async remove(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ): Promise<{ success: true }> {
        return this.printTemplatesService.remove(tenant.tenantId, id);
    }
}
