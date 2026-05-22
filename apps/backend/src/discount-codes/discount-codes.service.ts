import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateDiscountCodeDto, ValidateDiscountCodeDto } from './discount-codes.dto';

@Injectable()
export class DiscountCodesService {
    constructor(private db: DatabaseService) {}

    async list(tenantId: string) {
        return this.db.discountCode.findMany({
            where: { tenantId },
            orderBy: { created_at: 'desc' },
        });
    }

    async create(tenantId: string, dto: CreateDiscountCodeDto) {
        const code = dto.code.trim().toUpperCase();

        if (dto.type === 'PERCENTAGE' && dto.value > 100) {
            throw new BadRequestException('Percentage discount cannot exceed 100%');
        }

        const existing = await this.db.discountCode.findUnique({
            where: { tenantId_code: { tenantId, code } },
        });
        if (existing) throw new BadRequestException(`Code "${code}" already exists`);

        return this.db.discountCode.create({
            data: {
                tenantId,
                code,
                name: dto.name,
                type: dto.type,
                value: dto.value,
                min_purchase: dto.min_purchase ?? null,
                max_discount: dto.max_discount ?? null,
                usage_limit: dto.usage_limit ?? null,
                valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
                valid_until: dto.valid_until ? new Date(dto.valid_until) : null,
            },
        });
    }

    async toggle(tenantId: string, id: string) {
        const code = await this.db.discountCode.findFirst({ where: { id, tenantId } });
        if (!code) throw new NotFoundException('Discount code not found');

        return this.db.discountCode.update({
            where: { id },
            data: { is_active: !code.is_active },
        });
    }

    async remove(tenantId: string, id: string) {
        const code = await this.db.discountCode.findFirst({ where: { id, tenantId } });
        if (!code) throw new NotFoundException('Discount code not found');
        await this.db.discountCode.delete({ where: { id } });
        return { deleted: true };
    }

    async validate(tenantId: string, dto: ValidateDiscountCodeDto) {
        const code = dto.code.trim().toUpperCase();
        const cartTotal = dto.cart_total;
        const now = new Date();

        const discount = await this.db.discountCode.findUnique({
            where: { tenantId_code: { tenantId, code } },
        });

        if (!discount || !discount.is_active) {
            throw new BadRequestException('Invalid or inactive discount code');
        }
        if (discount.valid_from && discount.valid_from > now) {
            throw new BadRequestException('Discount code is not yet valid');
        }
        if (discount.valid_until && discount.valid_until < now) {
            throw new BadRequestException('Discount code has expired');
        }
        if (discount.usage_limit !== null && discount.used_count >= discount.usage_limit) {
            throw new BadRequestException('Discount code usage limit reached');
        }
        if (discount.min_purchase !== null && cartTotal < Number(discount.min_purchase)) {
            throw new BadRequestException(
                `Minimum purchase of ৳${Number(discount.min_purchase).toFixed(2)} required`,
            );
        }

        let discountAmount: number;
        if (discount.type === 'PERCENTAGE') {
            discountAmount = cartTotal * (Number(discount.value) / 100);
            if (discount.max_discount !== null) {
                discountAmount = Math.min(discountAmount, Number(discount.max_discount));
            }
        } else {
            discountAmount = Math.min(Number(discount.value), cartTotal);
        }

        return {
            code: discount.code,
            name: discount.name,
            type: discount.type,
            discount_amount: Math.round(discountAmount * 100) / 100,
        };
    }

    async recordUsage(tenantId: string, code: string) {
        await this.db.discountCode.updateMany({
            where: { tenantId, code: code.toUpperCase() },
            data: { used_count: { increment: 1 } },
        });
    }
}
