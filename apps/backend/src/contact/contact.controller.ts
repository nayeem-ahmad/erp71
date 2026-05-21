import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { EmailService } from '../email/email.service';

class ContactDto {
    @IsString()
    @MinLength(1)
    name: string;

    @IsEmail()
    email: string;

    @IsString()
    @MinLength(1)
    subject: string;

    @IsString()
    @MinLength(10)
    message: string;
}

@Controller('contact')
@Throttle({ default: { ttl: 60_000, limit: 3 } })
export class ContactController {
    constructor(private readonly emailService: EmailService) {}

    @Post()
    async submit(@Body() dto: ContactDto): Promise<{ success: true }> {
        this.emailService.sendContactForm(dto.email, dto.name, dto.subject, dto.message);
        return { success: true };
    }
}
