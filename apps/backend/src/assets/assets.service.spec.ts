import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';

// Mock the cloudinary v2 library before the module is imported
jest.mock('cloudinary', () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload_stream: jest.fn(),
            destroy: jest.fn(),
        },
        url: jest.fn(),
    },
}));

import { v2 as cloudinary } from 'cloudinary';

const mockConfig = cloudinary.config as jest.MockedFunction<typeof cloudinary.config>;
const mockUploadStream = cloudinary.uploader.upload_stream as jest.MockedFunction<
    typeof cloudinary.uploader.upload_stream
>;
const mockDestroy = cloudinary.uploader.destroy as jest.MockedFunction<
    typeof cloudinary.uploader.destroy
>;
const mockUrl = cloudinary.url as jest.MockedFunction<typeof cloudinary.url>;

describe('AssetsService', () => {
    let service: AssetsService;

    // Helper: build a fake Multer file
    const fakeFile = (buffer = Buffer.from('test-data')): Express.Multer.File =>
        ({
            buffer,
            originalname: 'test.jpg',
            fieldname: 'file',
            encoding: '7bit',
            mimetype: 'image/jpeg',
            size: buffer.length,
        } as Express.Multer.File);

    // Helper: simulate a successful upload_stream call.
    // upload_stream's TypeScript overload puts options+callback in a single spread — we use
    // mockImplementation to capture both args safely without relying on tuple indices.
    const simulateSuccessfulUpload = (secureUrl: string) => {
        const streamObj = { end: jest.fn() };
        mockUploadStream.mockImplementation((...args: any[]) => {
            // args[0] = options, args[1] = callback
            const cb = args[1] as (err: any, res: any) => void;
            streamObj.end.mockImplementation((buf: Buffer) => cb(null, { secure_url: secureUrl }));
            return streamObj as any;
        });
        return streamObj;
    };

    // Helper: simulate a failed upload_stream call
    const simulateFailedUpload = (error: Error) => {
        const streamObj = { end: jest.fn() };
        mockUploadStream.mockImplementation((...args: any[]) => {
            const cb = args[1] as (err: any, res: any) => void;
            streamObj.end.mockImplementation(() => cb(error, undefined));
            return streamObj as any;
        });
        return streamObj;
    };

    // ─── Module setup helpers ─────────────────────────────────────────────────

    async function buildModuleWithEnv(env: Record<string, string | undefined>) {
        // Set env vars before module init
        const originalEnv = { ...process.env };
        Object.assign(process.env, env);
        if (!env.CLOUDINARY_CLOUD_NAME) delete process.env.CLOUDINARY_CLOUD_NAME;
        if (!env.CLOUDINARY_API_KEY) delete process.env.CLOUDINARY_API_KEY;
        if (!env.CLOUDINARY_API_SECRET) delete process.env.CLOUDINARY_API_SECRET;

        const module: TestingModule = await Test.createTestingModule({
            providers: [AssetsService],
        }).compile();

        await module.init(); // triggers onModuleInit

        const svc = module.get<AssetsService>(AssetsService);

        // Restore
        process.env = originalEnv;
        return svc;
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ─── onModuleInit ─────────────────────────────────────────────────────────

    describe('onModuleInit', () => {
        it('should configure cloudinary and enable uploads when all env vars are set', async () => {
            service = await buildModuleWithEnv({
                CLOUDINARY_CLOUD_NAME: 'my-cloud',
                CLOUDINARY_API_KEY: 'key-123',
                CLOUDINARY_API_SECRET: 'secret-abc',
            });

            expect(mockConfig).toHaveBeenCalledWith({
                cloud_name: 'my-cloud',
                api_key: 'key-123',
                api_secret: 'secret-abc',
            });
        });

        it('should NOT configure cloudinary when env vars are missing', async () => {
            service = await buildModuleWithEnv({});

            expect(mockConfig).not.toHaveBeenCalled();
        });

        it('should NOT configure cloudinary when only some env vars are set', async () => {
            service = await buildModuleWithEnv({
                CLOUDINARY_CLOUD_NAME: 'my-cloud',
                // missing CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET
            });

            expect(mockConfig).not.toHaveBeenCalled();
        });
    });

    // ─── Tests with Cloudinary enabled ───────────────────────────────────────

    describe('with Cloudinary enabled', () => {
        beforeEach(async () => {
            service = await buildModuleWithEnv({
                CLOUDINARY_CLOUD_NAME: 'my-cloud',
                CLOUDINARY_API_KEY: 'key-123',
                CLOUDINARY_API_SECRET: 'secret-abc',
            });
            jest.clearAllMocks(); // clear config call from init
        });

        // ─── uploadFile ───────────────────────────────────────────────────────

        describe('uploadFile', () => {
            it('should upload a file and return the secure URL', async () => {
                const folder = 'tenant-xyz';
                const expectedUrl = 'https://res.cloudinary.com/my-cloud/image/upload/v1/retail/tenant-xyz/test.jpg';
                simulateSuccessfulUpload(expectedUrl);

                const result = await service.uploadFile(fakeFile(), folder);

                expect(mockUploadStream).toHaveBeenCalledWith(
                    expect.objectContaining({
                        folder: `retail/${folder}`,
                        resource_type: 'auto',
                        use_filename: true,
                        unique_filename: true,
                        overwrite: false,
                    }),
                    expect.any(Function),
                );
                expect(result).toBe(expectedUrl);
            });

            it('should call stream.end with the file buffer', async () => {
                const buffer = Buffer.from('image-bytes');
                const streamObj = simulateSuccessfulUpload('https://example.com/img.jpg');

                await service.uploadFile(fakeFile(buffer), 'tenant-abc');

                expect(streamObj.end).toHaveBeenCalledWith(buffer);
            });

            it('should reject when cloudinary upload returns an error', async () => {
                const uploadError = new Error('Cloudinary upload failed');
                simulateFailedUpload(uploadError);

                const promise = service.uploadFile(fakeFile(), 'tenant-xyz');

                await expect(promise).rejects.toThrow('Cloudinary upload failed');
            });

            it('should include transformation options in upload call', async () => {
                simulateSuccessfulUpload('https://example.com/img.jpg');

                await service.uploadFile(fakeFile(), 'tenant-1');

                expect(mockUploadStream).toHaveBeenCalledWith(
                    expect.objectContaining({
                        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
                    }),
                    expect.any(Function),
                );
            });
        });

        // ─── deleteFile ───────────────────────────────────────────────────────

        describe('deleteFile', () => {
            it('should call cloudinary destroy with the publicId', async () => {
                mockDestroy.mockResolvedValue({ result: 'ok' } as any);

                await service.deleteFile('retail/tenant-1/image123');

                expect(mockDestroy).toHaveBeenCalledWith('retail/tenant-1/image123');
            });

            it('should not throw when cloudinary destroy fails (logs error)', async () => {
                mockDestroy.mockRejectedValue(new Error('Network error'));

                await expect(service.deleteFile('some-public-id')).resolves.toBeUndefined();
            });
        });

        // ─── getOptimisedUrl ──────────────────────────────────────────────────

        describe('getOptimisedUrl', () => {
            it('should return an optimised URL without dimensions', () => {
                mockUrl.mockReturnValue('https://res.cloudinary.com/my-cloud/image/upload/q_auto,f_auto/public-id');

                const result = service.getOptimisedUrl('public-id');

                expect(mockUrl).toHaveBeenCalledWith('public-id', {
                    fetch_format: 'auto',
                    quality: 'auto',
                    secure: true,
                });
                expect(result).toBe('https://res.cloudinary.com/my-cloud/image/upload/q_auto,f_auto/public-id');
            });

            it('should include crop/gravity/dimensions when width and height are provided', () => {
                mockUrl.mockReturnValue('https://res.cloudinary.com/my-cloud/image/upload/c_auto,g_auto,w_200,h_200/public-id');

                const result = service.getOptimisedUrl('public-id', 200, 200);

                expect(mockUrl).toHaveBeenCalledWith('public-id', {
                    fetch_format: 'auto',
                    quality: 'auto',
                    secure: true,
                    crop: 'auto',
                    gravity: 'auto',
                    width: 200,
                    height: 200,
                });
                expect(result).toBeDefined();
            });

            it('should NOT include crop/gravity when only width is provided (no height)', () => {
                mockUrl.mockReturnValue('https://res.cloudinary.com/my-cloud/img.jpg');

                service.getOptimisedUrl('public-id', 300);

                expect(mockUrl).toHaveBeenCalledWith('public-id', {
                    fetch_format: 'auto',
                    quality: 'auto',
                    secure: true,
                });
            });

            it('should NOT include crop/gravity when only height is provided (no width)', () => {
                mockUrl.mockReturnValue('https://res.cloudinary.com/my-cloud/img.jpg');

                service.getOptimisedUrl('public-id', undefined, 300);

                expect(mockUrl).toHaveBeenCalledWith('public-id', {
                    fetch_format: 'auto',
                    quality: 'auto',
                    secure: true,
                });
            });
        });
    });

    // ─── Tests with Cloudinary disabled ──────────────────────────────────────

    describe('with Cloudinary disabled (missing env vars)', () => {
        beforeEach(async () => {
            service = await buildModuleWithEnv({});
            jest.clearAllMocks();
        });

        describe('uploadFile', () => {
            it('should throw an error when Cloudinary is not configured', async () => {
                const promise = service.uploadFile(fakeFile(), 'tenant-1');

                await expect(promise).rejects.toThrow('Cloudinary is not configured');
                expect(mockUploadStream).not.toHaveBeenCalled();
            });
        });

        describe('deleteFile', () => {
            it('should return without calling destroy when disabled', async () => {
                await service.deleteFile('some-public-id');

                expect(mockDestroy).not.toHaveBeenCalled();
            });
        });

        describe('getOptimisedUrl', () => {
            it('should still call cloudinary.url (no guard on this method)', () => {
                mockUrl.mockReturnValue('https://example.com/img.jpg');

                // getOptimisedUrl has no enabled check — it always proxies to cloudinary.url
                const result = service.getOptimisedUrl('public-id');

                expect(mockUrl).toHaveBeenCalled();
                expect(result).toBe('https://example.com/img.jpg');
            });
        });
    });
});
