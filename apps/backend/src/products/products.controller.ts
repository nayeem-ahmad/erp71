import {
    BadRequestException,
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './product.dto';
import { CsvProductRow } from './import-products.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

/**
 * Minimal CSV line parser that handles double-quoted fields (including commas
 * inside quotes) and trims surrounding whitespace from unquoted values.
 */
function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (inQuotes) {
            if (ch === '"') {
                // Escaped quote?
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }

    result.push(current.trim());
    return result;
}

@Controller('products')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Post('import')
    @UseInterceptors(FileInterceptor('file'))
    async importCsv(
        @Tenant() tenant: TenantContext,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const content = file.buffer.toString('utf8');
        const lines = content.split(/\r?\n/);

        // Skip empty lines and the header row (index 0)
        const dataLines = lines.slice(1).filter((line) => line.trim() !== '');

        const rows: CsvProductRow[] = [];
        const parseErrors: string[] = [];

        // Expected header order: name,sku,barcode,selling_price,cost_price,stock_quantity,reorder_point,unit
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i];
            const rowNumber = i + 2; // +2: 1-based + header row offset

            try {
                const cols = parseCsvLine(line);
                const name = cols[0] ?? '';
                const sku = cols[1] ?? '';
                const barcode = cols[2] ?? '';
                const sellingPriceRaw = cols[3] ?? '';
                const costPriceRaw = cols[4] ?? '';
                const stockQtyRaw = cols[5] ?? '';
                const reorderPointRaw = cols[6] ?? '';
                const unit = cols[7] ?? '';

                const selling_price = parseFloat(sellingPriceRaw);
                if (isNaN(selling_price)) {
                    parseErrors.push(`Row ${rowNumber}: invalid selling_price "${sellingPriceRaw}"`);
                    continue;
                }

                rows.push({
                    name: name.trim(),
                    sku: sku.trim() || undefined,
                    barcode: barcode.trim() || undefined,
                    selling_price,
                    cost_price: costPriceRaw.trim() ? parseFloat(costPriceRaw) : undefined,
                    stock_quantity: stockQtyRaw.trim() ? parseInt(stockQtyRaw, 10) : undefined,
                    reorder_point: reorderPointRaw.trim() ? parseInt(reorderPointRaw, 10) : undefined,
                    unit: unit.trim() || undefined,
                });
            } catch {
                parseErrors.push(`Row ${rowNumber}: failed to parse line`);
            }
        }

        const result = await this.productsService.importFromCsv(tenant.tenantId, rows);

        return {
            created: result.created,
            skipped: result.skipped,
            errors: [...parseErrors, ...result.errors],
        };
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProductDto) {
        return this.productsService.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('groupId') groupId?: string,
        @Query('subgroupId') subgroupId?: string,
        @Query('uncategorized') uncategorized?: string,
        @Query('cursor') cursor?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const parsedLimit = limit ? parseInt(limit, 10) : undefined;
        if (cursor !== undefined) {
            return this.productsService.findAllCursor(tenant.tenantId, {
                groupId,
                subgroupId,
                uncategorized: uncategorized === 'true',
                cursor: cursor || undefined,
                limit: parsedLimit,
            });
        }
        return this.productsService.findAll(tenant.tenantId, {
            groupId,
            subgroupId,
            uncategorized: uncategorized === 'true',
            page: page ? parseInt(page, 10) : undefined,
            limit: parsedLimit,
        });
    }

    @Get('search/by-quantity')
    searchByQuantity(
        @Tenant() tenant: TenantContext,
        @Query('q') query: string,
        @Query('limit') limit?: string,
    ) {
        const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
        return this.productsService.searchByQuantitySold(tenant.tenantId, query || '', parsedLimit);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.productsService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateProductDto,
    ) {
        return this.productsService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.productsService.remove(tenant.tenantId, id);
    }
}
