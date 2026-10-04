import { BadRequestException } from '@nestjs/common';
import { isDirectUpload, verifyDirectUpload, type DirectUploadExpectation } from './direct-upload.util';

const TENANT_A = '0b6c2a52-5f0e-4d8e-9a1f-6d2f1c3b4a5e';
const TENANT_B = '7f3e9d21-1c2b-4a3d-8e9f-0a1b2c3d4e5f';

const expected: DirectUploadExpectation = {
    cloudName: 'erp71',
    folder: `retail/${TENANT_A}/products`,
    resourceType: 'image',
};

/** What Cloudinary actually returns for an image uploaded into `folder`. */
const result = (publicId: string, url?: string) => ({
    public_id: publicId,
    secure_url: url ?? `https://res.cloudinary.com/erp71/image/upload/v1759999999/${publicId}.jpg`,
});

describe('verifyDirectUpload', () => {
    const ownId = `retail/${TENANT_A}/products/k3x9p2qhv1`;

    it('accepts an image in this tenant’s folder for this purpose, in our cloud', () => {
        expect(verifyDirectUpload(result(ownId), expected)).toEqual({
            url: `https://res.cloudinary.com/erp71/image/upload/v1759999999/${ownId}.jpg`,
            publicId: ownId,
        });
    });

    it('accepts the URL without a version segment or an extension', () => {
        const url = `https://res.cloudinary.com/erp71/image/upload/${ownId}`;
        expect(verifyDirectUpload(result(ownId, url), expected).url).toBe(url);
    });

    describe('refuses another tenant’s asset', () => {
        it('when the public_id sits in another tenant’s folder', () => {
            const foreign = `retail/${TENANT_B}/products/k3x9p2qhv1`;
            expect(() => verifyDirectUpload(result(foreign), expected)).toThrow(BadRequestException);
        });

        it('when the public_id is this tenant’s but for another purpose', () => {
            const otherPurpose = `retail/${TENANT_A}/crm-photos/k3x9p2qhv1`;
            expect(() => verifyDirectUpload(result(otherPurpose), expected)).toThrow(
                'That image does not belong to this account.',
            );
        });

        it('when the folder is only a prefix of the id’s first segment', () => {
            // `retail/<A>/products-old/…` starts with `retail/<A>/products` as a
            // string; the check has to be on the folder boundary.
            const sibling = `retail/${TENANT_A}/products-old/k3x9p2qhv1`;
            expect(() => verifyDirectUpload(result(sibling), expected)).toThrow(BadRequestException);
        });

        it('when the id climbs out of the folder', () => {
            const climbing = `retail/${TENANT_A}/products/../../${TENANT_B}/products/x`;
            expect(() => verifyDirectUpload(result(climbing), expected)).toThrow(BadRequestException);
        });

        it('when the id is the folder itself', () => {
            expect(() => verifyDirectUpload(result(`retail/${TENANT_A}/products/`), expected)).toThrow(
                BadRequestException,
            );
        });

        it('when the URL names a different asset than the id', () => {
            const url = `https://res.cloudinary.com/erp71/image/upload/v1/retail/${TENANT_B}/products/k3x9p2qhv1.jpg`;
            expect(() => verifyDirectUpload(result(ownId, url), expected)).toThrow(BadRequestException);
        });

        it('when the URL names an asset whose id merely starts with ours', () => {
            const url = `https://res.cloudinary.com/erp71/image/upload/v1/${ownId}extra.jpg`;
            expect(() => verifyDirectUpload(result(ownId, url), expected)).toThrow(BadRequestException);
        });
    });

    describe('refuses a URL that is not an image in our cloud', () => {
        const bad: Array<[string, string]> = [
            ['another host', `https://evil.example/erp71/image/upload/v1/${ownId}.jpg`],
            ['a look-alike host', `https://res.cloudinary.com.evil.example/erp71/image/upload/v1/${ownId}.jpg`],
            ['plain http', `http://res.cloudinary.com/erp71/image/upload/v1/${ownId}.jpg`],
            ['another Cloudinary account', `https://res.cloudinary.com/someone-else/image/upload/v1/${ownId}.jpg`],
            ['a raw upload', `https://res.cloudinary.com/erp71/raw/upload/v1/${ownId}.jpg`],
            ['a transformation segment', `https://res.cloudinary.com/erp71/image/upload/w_10/${ownId}.jpg`],
            ['a fetch URL', `https://res.cloudinary.com/erp71/image/fetch/https://evil.example/x.jpg`],
            ['a query string', `https://res.cloudinary.com/erp71/image/upload/v1/${ownId}.jpg?x=1`],
            ['credentials', `https://user:pw@res.cloudinary.com/erp71/image/upload/v1/${ownId}.jpg`],
            ['a port', `https://res.cloudinary.com:8443/erp71/image/upload/v1/${ownId}.jpg`],
            ['not a URL', 'javascript:alert(1)'],
        ];

        it.each(bad)('%s', (_label, url) => {
            expect(() => verifyDirectUpload(result(ownId, url), expected)).toThrow(BadRequestException);
        });
    });

    it('refuses everything when the cloud name is not configured', () => {
        expect(() => verifyDirectUpload(result(ownId), { ...expected, cloudName: '' })).toThrow(
            BadRequestException,
        );
    });

    it('refuses a result missing either half', () => {
        expect(() => verifyDirectUpload({ public_id: ownId }, expected)).toThrow(BadRequestException);
        expect(() => verifyDirectUpload({ secure_url: result(ownId).secure_url }, expected)).toThrow(
            BadRequestException,
        );
        expect(() => verifyDirectUpload({ public_id: 42, secure_url: {} }, expected)).toThrow(
            BadRequestException,
        );
    });
});

describe('isDirectUpload', () => {
    it('tells a direct-upload body from the old payload', () => {
        expect(isDirectUpload({ public_id: 'x', secure_url: 'y' })).toBe(true);
        expect(isDirectUpload({ public_id: 'x' })).toBe(true);
        expect(isDirectUpload({ imageBase64: 'data:…' } as any)).toBe(false);
        expect(isDirectUpload({})).toBe(false);
        expect(isDirectUpload(undefined)).toBe(false);
    });
});
