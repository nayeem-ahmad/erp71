import { IsOptional, IsString } from 'class-validator';

export class PurchaseSmsCreditsDto {
    @IsString()
    packageId!: string;
}

export class ConfirmSmsCreditsPurchaseDto {
    @IsString()
    packageId!: string;

    @IsOptional()
    @IsString()
    reference?: string;
}
