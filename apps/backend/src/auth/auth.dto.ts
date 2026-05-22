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

export class UpdateProfileDto {
    name?: string;
}

export class ChangePasswordDto {
    currentPassword: string;
    newPassword: string;
}
