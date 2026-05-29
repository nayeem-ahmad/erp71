export class ListAdminTenantsQueryDto {
    search?: string;
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
    status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
}

export class UpdateAdminTenantSubscriptionDto {
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
    status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
    billingCycle?: 'MONTHLY' | 'YEARLY';
    cancelAtPeriodEnd?: boolean;
}

export class SuspendTenantDto {
    reason?: string;
}

export class ListAdminUsersQueryDto {
    search?: string;
    page?: number;
    limit?: number;
}

export class PromoteUserDto {
    userId: string;
}