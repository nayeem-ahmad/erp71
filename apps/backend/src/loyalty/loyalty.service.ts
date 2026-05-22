import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateLoyaltySettingsDto, EarnPointsDto, RedeemPointsDto, AdjustPointsDto } from './loyalty.dto';

@Injectable()
export class LoyaltyService {
    constructor(private db: DatabaseService) {}

    async getSettings(tenantId: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                loyalty_points_enabled: true,
                loyalty_earn_rate: true,
                loyalty_redeem_rate: true,
                loyalty_min_redeem: true,
            },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return tenant;
    }

    async updateSettings(tenantId: string, dto: UpdateLoyaltySettingsDto) {
        return this.db.tenant.update({
            where: { id: tenantId },
            data: {
                ...(dto.loyalty_points_enabled !== undefined
                    ? { loyalty_points_enabled: dto.loyalty_points_enabled }
                    : {}),
                ...(dto.loyalty_earn_rate !== undefined
                    ? { loyalty_earn_rate: dto.loyalty_earn_rate ?? null }
                    : {}),
                ...(dto.loyalty_redeem_rate !== undefined
                    ? { loyalty_redeem_rate: dto.loyalty_redeem_rate ?? null }
                    : {}),
                ...(dto.loyalty_min_redeem !== undefined
                    ? { loyalty_min_redeem: dto.loyalty_min_redeem ?? null }
                    : {}),
            },
            select: {
                loyalty_points_enabled: true,
                loyalty_earn_rate: true,
                loyalty_redeem_rate: true,
                loyalty_min_redeem: true,
            },
        });
    }

    async getCustomerPoints(tenantId: string, customerId: string) {
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: {
                id: true,
                name: true,
                phone: true,
                loyalty_points: true,
            },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const transactions = await this.db.loyaltyTransaction.findMany({
            where: { customerId, tenantId },
            orderBy: { created_at: 'desc' },
            take: 20,
        });

        return { ...customer, transactions };
    }

    async earnPoints(tenantId: string, customerId: string, dto: EarnPointsDto) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                loyalty_points_enabled: true,
                loyalty_earn_rate: true,
            },
        });

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!tenant.loyalty_points_enabled) {
            throw new BadRequestException('Loyalty program is not enabled');
        }
        if (!tenant.loyalty_earn_rate) {
            throw new BadRequestException('Earn rate is not configured');
        }

        const earnRate = Number(tenant.loyalty_earn_rate);
        const pointsEarned = Math.floor(dto.saleTotal * earnRate);

        if (pointsEarned <= 0) {
            return { points_earned: 0, message: 'No points earned for this sale amount' };
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, loyalty_points: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const [transaction] = await this.db.$transaction([
            this.db.loyaltyTransaction.create({
                data: {
                    tenantId,
                    customerId,
                    saleId: dto.saleId ?? null,
                    type: 'EARN',
                    points: pointsEarned,
                    description: `Earned from sale of ৳${dto.saleTotal.toFixed(2)}`,
                },
            }),
            this.db.customer.update({
                where: { id: customerId },
                data: { loyalty_points: { increment: pointsEarned } },
            }),
        ]);

        return {
            points_earned: pointsEarned,
            new_balance: customer.loyalty_points + pointsEarned,
            transaction,
        };
    }

    async redeemPoints(tenantId: string, customerId: string, dto: RedeemPointsDto) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                loyalty_points_enabled: true,
                loyalty_redeem_rate: true,
                loyalty_min_redeem: true,
            },
        });

        if (!tenant) throw new NotFoundException('Tenant not found');
        if (!tenant.loyalty_points_enabled) {
            throw new BadRequestException('Loyalty program is not enabled');
        }
        if (!tenant.loyalty_redeem_rate) {
            throw new BadRequestException('Redemption rate is not configured');
        }

        const minRedeem = tenant.loyalty_min_redeem ?? 0;
        if (dto.points < minRedeem) {
            throw new BadRequestException(
                `Minimum redemption is ${minRedeem} points`,
            );
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, loyalty_points: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        if (customer.loyalty_points < dto.points) {
            throw new BadRequestException(
                `Insufficient points. Customer has ${customer.loyalty_points} points, requested ${dto.points}`,
            );
        }

        const redeemRate = Number(tenant.loyalty_redeem_rate);
        const discountAmount = dto.points * redeemRate;

        const [transaction] = await this.db.$transaction([
            this.db.loyaltyTransaction.create({
                data: {
                    tenantId,
                    customerId,
                    type: 'REDEEM',
                    points: -dto.points,
                    description: `Redeemed ${dto.points} points for ৳${discountAmount.toFixed(2)} discount`,
                },
            }),
            this.db.customer.update({
                where: { id: customerId },
                data: { loyalty_points: { decrement: dto.points } },
            }),
        ]);

        return {
            points_redeemed: dto.points,
            discount_amount: discountAmount,
            new_balance: customer.loyalty_points - dto.points,
            transaction,
        };
    }

    async adjustPoints(
        tenantId: string,
        customerId: string,
        dto: AdjustPointsDto,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, tenant_id: tenantId, deleted_at: null },
            select: { id: true, loyalty_points: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const newBalance = customer.loyalty_points + dto.points;
        if (newBalance < 0) {
            throw new BadRequestException(
                `Adjustment would result in negative balance. Current balance: ${customer.loyalty_points}`,
            );
        }

        const [transaction] = await this.db.$transaction([
            this.db.loyaltyTransaction.create({
                data: {
                    tenantId,
                    customerId,
                    type: 'ADJUST',
                    points: dto.points,
                    description: dto.description ?? 'Manual adjustment',
                },
            }),
            this.db.customer.update({
                where: { id: customerId },
                data: { loyalty_points: { increment: dto.points } },
            }),
        ]);

        return {
            points_adjusted: dto.points,
            new_balance: newBalance,
            transaction,
        };
    }

    async listCustomersWithPoints(tenantId: string, search?: string) {
        const customers = await this.db.customer.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(search
                    ? {
                          OR: [
                              { name: { contains: search, mode: 'insensitive' } },
                              { phone: { contains: search, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
            select: {
                id: true,
                name: true,
                phone: true,
                loyalty_points: true,
                loyaltyTransactions: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: { created_at: true },
                },
            },
            orderBy: { loyalty_points: 'desc' },
            take: 100,
        });

        return customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            loyalty_points: c.loyalty_points,
            last_transaction_at: c.loyaltyTransactions[0]?.created_at ?? null,
        }));
    }
}
