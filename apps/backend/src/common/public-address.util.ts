import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Ranges an outbound connection on a tenant's or a model's behalf must never
 * reach. The interesting entries are not the obvious loopback ones:
 * 169.254.169.254 (link-local) is the cloud metadata endpoint that turns a
 * fetch into credential theft, and 100.64/10 is carrier-grade NAT, which on a
 * VPS host is other tenants. On this deployment the Docker network (Postgres,
 * Redis, the API itself) sits in 172.16/12.
 */
const BLOCKED_V4: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
];

const BLOCKED_V6: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['64:ff9b::', 96],
];

function buildBlockList(): BlockList {
    const list = new BlockList();
    for (const [net, prefix] of BLOCKED_V4) list.addSubnet(net, prefix, 'ipv4');
    for (const [net, prefix] of BLOCKED_V6) list.addSubnet(net, prefix, 'ipv6');
    return list;
}

const BLOCKED_ADDRESSES = buildBlockList();

/** True when `address` is a literal IP outside every blocked range. */
export function isPublicAddress(address: string): boolean {
    // ::ffff:10.0.0.1 is 10.0.0.1 wearing a hat — compare the address it maps.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const candidate = mapped ? mapped[1] : address;
    const version = isIP(candidate);
    if (version === 0) return false;
    return !BLOCKED_ADDRESSES.check(candidate, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * `ok` with the checked addresses, or the reason it was refused. One flat shape
 * rather than a union: the backend compiles without strict null checks, which
 * would leave a union on `ok` un-narrowed at the call site.
 */
export interface PublicResolution {
    ok: boolean;
    addresses: string[];
    reason?: 'unresolvable' | 'private';
    /** The first non-public address found, when `reason` is `private`. */
    address?: string;
}

/**
 * Resolves `host` and accepts it only when *every* address is public: a host
 * that returns one public and one internal address would otherwise be a coin
 * flip. Callers should connect to one of the returned addresses rather than
 * resolving the name again, so a DNS answer cannot change between check and use.
 */
export async function resolvePublicHost(
    host: string,
    resolve: typeof lookup = lookup,
): Promise<PublicResolution> {
    const bare = host.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (isIP(bare)) {
        addresses = [bare];
    } else {
        try {
            const records = await resolve(bare, { all: true, verbatim: true });
            addresses = records.map((r) => r.address);
        } catch {
            return { ok: false, addresses: [], reason: 'unresolvable' };
        }
    }

    if (addresses.length === 0) return { ok: false, addresses: [], reason: 'unresolvable' };
    for (const address of addresses) {
        if (!isPublicAddress(address)) return { ok: false, addresses: [], reason: 'private', address };
    }
    return { ok: true, addresses };
}
