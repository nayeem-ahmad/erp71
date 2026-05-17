export class SignupDto {
    email: string;
    password: string;
    name?: string;
    tenantName: string;
    storeName: string;
    address?: string;
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
}

export class LoginDto {
    email: string;
    password: string;
}

export class CreateStoreDto {
    tenantName?: string;
    name: string;
    address?: string;
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
}

export class RefreshTokenDto {
    refresh_token: string;
}

export class ForgotPasswordDto {
    email: string;
}

export class ResetPasswordDto {
    token: string;
    password: string;
}
