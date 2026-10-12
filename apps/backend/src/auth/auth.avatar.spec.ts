import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseTokenService } from './firebase-token.service';
import { GoogleTokenService } from './google-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TotpService } from './totp.service';
import { AssetsService } from '../assets/assets.service';

/**
 * `PATCH /auth/me/avatar` takes two bodies: the file (mobile, older clients) or
 * the result of the browser's direct upload to Cloudinary. `avatar_url` used to
 * be written only by the server, so the second kind is checked before it is
 * stored — this user's own folder, our own cloud.
 */
const ENV = {
    CLOUDINARY_CLOUD_NAME: 'erp71',
    CLOUDINARY_API_KEY: '123456789012345',
    CLOUDINARY_API_SECRET: 'shh-its-a-secret',
};

const own = (userId: string, id = 'a1b2c3') => ({
    public_id: `retail/avatars/${userId}/${id}`,
    secure_url: `https://res.cloudinary.com/erp71/image/upload/v1759999999/retail/avatars/${userId}/${id}.jpg`,
});

describe('avatar from a direct upload', () => {
    const saved: Record<string, string | undefined> = {};

    beforeAll(() => {
        for (const [key, value] of Object.entries(ENV)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    afterAll(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    describe('AuthService.updateAvatarFromUpload', () => {
        let db: { user: { update: jest.Mock } };
        let service: AuthService;

        beforeEach(() => {
            db = {
                user: {
                    update: jest.fn().mockImplementation(({ data }: any) =>
                        Promise.resolve({ id: 'user-1', avatar_url: data.avatar_url }),
                    ),
                },
            };
            const assets = new AssetsService();
            assets.onModuleInit();
            // Only the database and storage are reached on this path; the rest of
            // AuthService's collaborators are left out rather than mocked.
            const ctorArgs: unknown[] = new Array(13).fill(undefined);
            ctorArgs[0] = db;
            ctorArgs[5] = assets;
            service = new (AuthService as unknown as new (...args: unknown[]) => AuthService)(...ctorArgs);
        });

        it('stores an image from the user’s own avatar folder', async () => {
            const upload = own('user-1');

            await expect(service.updateAvatarFromUpload('user-1', upload)).resolves.toEqual({
                avatarUrl: upload.secure_url,
            });
            expect(db.user.update).toHaveBeenCalledWith({
                where: { id: 'user-1' },
                data: { avatar_url: upload.secure_url },
                select: { id: true, avatar_url: true },
            });
        });

        it('refuses another user’s picture', async () => {
            await expect(service.updateAvatarFromUpload('user-1', own('user-2'))).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('refuses a tenant asset that is not an avatar', async () => {
            const tenantPhoto = {
                public_id: 'retail/tenant-a/crm-photos/a1b2c3',
                secure_url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-a/crm-photos/a1b2c3.jpg',
            };
            await expect(service.updateAvatarFromUpload('user-1', tenantPhoto)).rejects.toBeInstanceOf(
                BadRequestException,
            );
            expect(db.user.update).not.toHaveBeenCalled();
        });

        it('refuses a URL that is not on our Cloudinary account', async () => {
            const { public_id } = own('user-1');
            for (const secure_url of [
                `https://tracker.example/${public_id}.jpg`,
                `https://res.cloudinary.com/another-cloud/image/upload/v1/${public_id}.jpg`,
            ]) {
                await expect(
                    service.updateAvatarFromUpload('user-1', { public_id, secure_url }),
                ).rejects.toBeInstanceOf(BadRequestException);
            }
            expect(db.user.update).not.toHaveBeenCalled();
        });
    });

    describe('PATCH /auth/me/avatar', () => {
        let app: INestApplication;
        const authService = {
            updateAvatar: jest.fn().mockResolvedValue({ avatarUrl: 'from-file' }),
            updateAvatarFromUpload: jest.fn().mockResolvedValue({ avatarUrl: 'from-upload' }),
        };

        beforeEach(async () => {
            jest.clearAllMocks();
            const moduleRef = await Test.createTestingModule({
                controllers: [AuthController],
                providers: [
                    { provide: AuthService, useValue: authService },
                    { provide: TotpService, useValue: {} },
                    { provide: GoogleTokenService, useValue: {} },
                    { provide: FirebaseTokenService, useValue: {} },
                ],
            })
                .overrideGuard(JwtAuthGuard)
                .useValue({
                    canActivate: (context: any) => {
                        context.switchToHttp().getRequest().user = { userId: 'user-1' };
                        return true;
                    },
                })
                .compile();
            app = moduleRef.createNestApplication();
            // As main.ts configures it.
            app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
            await app.init();
        });

        afterEach(async () => {
            await app.close();
        });

        it('saves a direct-upload result sent as JSON', async () => {
            const upload = own('user-1');

            const res = await request(app.getHttpServer()).patch('/auth/me/avatar').send(upload);

            expect(res.status).toBe(200);
            expect(authService.updateAvatarFromUpload).toHaveBeenCalledWith('user-1', expect.objectContaining(upload));
            expect(authService.updateAvatar).not.toHaveBeenCalled();
        });

        it('still takes the file itself, as the mobile app sends it', async () => {
            const res = await request(app.getHttpServer())
                .patch('/auth/me/avatar')
                .attach('avatar', Buffer.from('fake-jpeg'), { filename: 'me.jpg', contentType: 'image/jpeg' });

            expect(res.status).toBe(200);
            expect(authService.updateAvatar).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({ originalname: 'me.jpg' }),
            );
            expect(authService.updateAvatarFromUpload).not.toHaveBeenCalled();
        });

        it('refuses a body with neither', async () => {
            const res = await request(app.getHttpServer()).patch('/auth/me/avatar').send({});

            expect(res.status).toBe(400);
            expect(authService.updateAvatar).not.toHaveBeenCalled();
            expect(authService.updateAvatarFromUpload).not.toHaveBeenCalled();
        });

        it('refuses fields beyond the upload result', async () => {
            const res = await request(app.getHttpServer())
                .patch('/auth/me/avatar')
                .send({ ...own('user-1'), avatar_url: 'https://tracker.example/x.gif' });

            expect(res.status).toBe(400);
            expect(authService.updateAvatarFromUpload).not.toHaveBeenCalled();
        });
    });
});
