export class CreateSaleItemDto {
    productId: string;
    quantity: number;
    priceAtSale: number;
    serialNumbers?: string[];
}

export class CreatePaymentDto {
    paymentMethod: string;
    amount: number;
    accountId?: string; // Links payment to account for accounting
}

export class CreateSaleDto {
    storeId: string;
    warehouseId?: string;
    customerId?: string;
    counterId?: string;
    referenceNumber?: string; // User-editable reference number
    totalAmount: number;
    amountPaid: number;
    items: CreateSaleItemDto[];
    payments?: CreatePaymentDto[];
    note?: string;
    /** Optional promo/discount code amount already applied on the client */
    discountAmount?: number;
    /** Loyalty points the customer wants to redeem on this sale */
    pointsToRedeem?: number;
}

export class UpdateSaleItemDto {
    productId: string;
    quantity: number;
    priceAtSale: number;
    serialNumbers?: string[];
}

export class UpdatePaymentDto {
    paymentMethod: string;
    amount: number;
    accountId?: string;
}

export class UpdateSaleDto {
    customerId?: string | null;
    status?: string;
    note?: string;
    items?: UpdateSaleItemDto[];
    payments?: UpdatePaymentDto[];
}
