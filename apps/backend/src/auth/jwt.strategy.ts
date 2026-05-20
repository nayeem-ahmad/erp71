import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private db: DatabaseService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
            passReqToCallback: false,
        });
    }

    async validate(payload: any) {
        const user = await this.db.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, token_version: true },
        });

        if (!user) throw new UnauthorizedException('User not found');

        // Reject tokens issued before a password change or logout
        if (payload.tv !== undefined && payload.tv !== user.token_version) {
            throw new UnauthorizedException('Session invalidated');
        }

        return { userId: user.id, email: user.email };
    }
}
