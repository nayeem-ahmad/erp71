import {
    DirectUploadError,
    directUpload,
    directUploader,
    resetDirectUploadAvailability,
    uploadToCloudinary,
    withServerFallback,
    type UploadSignature,
} from './direct-upload';

const mockGetUploadSignature = jest.fn();
jest.mock('@/lib/api', () => ({
    api: { getUploadSignature: (...args: unknown[]) => mockGetUploadSignature(...args) },
}));

const SIGNATURE: UploadSignature = {
    cloudName: 'erp71',
    apiKey: '123456789012345',
    timestamp: 1759999999,
    signature: 'abc123',
    folder: 'retail/tenant-a/products',
    publicIdPrefix: 'retail/tenant-a/products/',
    resourceType: 'image',
    uploadUrl: 'https://api.cloudinary.com/v1_1/erp71/image/upload',
    params: {
        allowed_formats: 'jpg,jpeg,png,webp',
        folder: 'retail/tenant-a/products',
        timestamp: '1759999999',
        transformation: 'f_auto,q_auto',
    },
    allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
    maxBytes: 5 * 1024 * 1024,
};

const UPLOADED = {
    secure_url: 'https://res.cloudinary.com/erp71/image/upload/v1/retail/tenant-a/products/k3x9.jpg',
    public_id: 'retail/tenant-a/products/k3x9',
};

const image = (name = 'shirt.jpg', type = 'image/jpeg', bytes = 3) =>
    new File([new Uint8Array(bytes)], name, { type });

const cloudinaryAnswers = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const mockFetch = jest.fn();
const realFetch = global.fetch;

afterAll(() => {
    global.fetch = realFetch;
});

beforeEach(() => {
    jest.clearAllMocks();
    resetDirectUploadAvailability();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockGetUploadSignature.mockResolvedValue(SIGNATURE);
    mockFetch.mockResolvedValue(cloudinaryAnswers(200, { ...UPLOADED, bytes: 3, format: 'jpg' }));
});

describe('directUpload', () => {
    it('signs for the purpose, posts the file straight to Cloudinary, and returns where it went', async () => {
        const file = image();

        await expect(directUpload(file, 'product-image')).resolves.toEqual(UPLOADED);

        expect(mockGetUploadSignature).toHaveBeenCalledWith('product-image');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('https://api.cloudinary.com/v1_1/erp71/image/upload');
        expect(init.method).toBe('POST');
        // No custom headers: a FormData POST stays a CORS "simple" request, so
        // there is no preflight round trip to Cloudinary.
        expect(init.headers).toBeUndefined();

        const form = init.body as FormData;
        expect(form.get('file')).toBe(file);
        expect(form.get('api_key')).toBe(SIGNATURE.apiKey);
        expect(form.get('signature')).toBe(SIGNATURE.signature);
        for (const [key, value] of Object.entries(SIGNATURE.params)) {
            expect(form.get(key)).toBe(value);
        }
        // Exactly what was signed and nothing more — an extra field would void it.
        expect(Array.from(form.keys()).sort()).toEqual(
            ['api_key', 'file', 'signature', ...Object.keys(SIGNATURE.params)].sort(),
        );
    });

    it('surfaces Cloudinary’s own refusal', async () => {
        mockFetch.mockResolvedValue(cloudinaryAnswers(400, { error: { message: 'Invalid Signature abc123.' } }));

        const failure = directUpload(image(), 'product-image');

        await expect(failure).rejects.toBeInstanceOf(DirectUploadError);
        await expect(failure).rejects.toMatchObject({ reason: 'rejected', message: 'Invalid Signature abc123.' });
    });

    it('treats an answer without an address as a refusal', async () => {
        mockFetch.mockResolvedValue(cloudinaryAnswers(200, { public_id: UPLOADED.public_id }));

        await expect(directUpload(image(), 'product-image')).rejects.toMatchObject({ reason: 'rejected' });
    });

    it('fails when the API will not sign', async () => {
        mockGetUploadSignature.mockRejectedValue(new Error('Requires one of these store permissions'));

        await expect(directUpload(image(), 'storefront-image')).rejects.toThrow('Requires one of these');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('stops trying Cloudinary for the session once it is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        await expect(directUpload(image(), 'product-image')).rejects.toMatchObject({ reason: 'network' });

        // The next upload goes straight to the fallback: no signature, no wait.
        mockGetUploadSignature.mockClear();
        await expect(directUpload(image(), 'product-image')).rejects.toMatchObject({ reason: 'unavailable' });
        expect(mockGetUploadSignature).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        resetDirectUploadAvailability();
        await expect(directUpload(image(), 'product-image')).resolves.toEqual(UPLOADED);
    });

    it('a refusal is not taken as Cloudinary being unreachable', async () => {
        mockFetch.mockResolvedValueOnce(cloudinaryAnswers(400, { error: { message: 'Image file format gif not allowed' } }));

        await expect(directUpload(image(), 'product-image')).rejects.toMatchObject({ reason: 'rejected' });
        await expect(directUpload(image(), 'product-image')).resolves.toEqual(UPLOADED);
    });

    it.each([
        ['a file over the ceiling', image('big.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1)],
        ['a type the folder will not take', image('anim.gif', 'image/gif')],
        ['a document', image('invoice.pdf', 'application/pdf')],
    ])('refuses %s before asking for a signature', async (_label, file) => {
        await expect(directUpload(file, 'product-image')).rejects.toMatchObject({ reason: 'unsupported' });
        expect(mockGetUploadSignature).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('holds a file to the signature’s own limits too', async () => {
        await expect(
            uploadToCloudinary(image('logo.png', 'image/png'), { ...SIGNATURE, allowedFormats: ['jpg'] }),
        ).rejects.toMatchObject({ reason: 'unsupported' });
        await expect(
            uploadToCloudinary(image('a.jpg', 'image/jpeg', 10), { ...SIGNATURE, maxBytes: 5 }),
        ).rejects.toMatchObject({ reason: 'unsupported' });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('posts only to Cloudinary’s upload API, whatever the signature says', async () => {
        await uploadToCloudinary(image(), { ...SIGNATURE, uploadUrl: 'https://evil.example/collect' });

        expect(mockFetch.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/erp71/image/upload');
    });
});

describe('directUploader', () => {
    it('asks for one signature however many files the batch has', async () => {
        const upload = directUploader('product-image');

        await Promise.all([upload(image('a.jpg')), upload(image('b.jpg')), upload(image('c.jpg'))]);

        expect(mockGetUploadSignature).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });
});

describe('withServerFallback', () => {
    it('uses the direct result when there is one', async () => {
        const fallback = jest.fn();

        await expect(withServerFallback(async () => 'direct', fallback)).resolves.toBe('direct');
        expect(fallback).not.toHaveBeenCalled();
    });

    it('takes the server route once when the direct upload fails', async () => {
        const fallback = jest.fn().mockResolvedValue('server');

        await expect(
            withServerFallback(() => Promise.reject(new DirectUploadError('x', 'network')), fallback),
        ).resolves.toBe('server');
        expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('reports the server route’s own error when that fails too', async () => {
        await expect(
            withServerFallback(
                () => Promise.reject(new Error('direct')),
                () => Promise.reject(new Error('Image is too large to keep.')),
            ),
        ).rejects.toThrow('Image is too large to keep.');
    });
});
