import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

/**
 * Client for Buffer's GraphQL publishing API (https://developers.buffer.com).
 *
 * Why Buffer rather than the Facebook Graph API directly: page access tokens
 * expire and have to be re-consented, and Meta's app review is a per-app hurdle
 * this platform has no reason to clear just to post its own marketing copy.
 * Buffer already holds the page connection, so the credential kept here is one
 * API key rather than a token per page per network.
 *
 * Everything is a single POST to one endpoint — GraphQL, so there is no route
 * table to mirror and the queries below are the whole surface.
 */

export const BUFFER_DEFAULT_API_URL = 'https://api.buffer.com';

/**
 * Posting modes as this API accepts them — these are the values validated by
 * the DTO and stored on `socialMediaPostPush.mode`, not Buffer's wire values.
 * See `SHARE_MODE` for the translation.
 */
export const BufferPostMode = {
    /** Next free slot in the channel's posting schedule. */
    ADD_TO_QUEUE: 'addToQueue',
    /** Publish as soon as Buffer picks it up. */
    NOW: 'now',
    /** Jump the queue — first slot instead of last. */
    NEXT: 'next',
    /** Exact time, which is the only mode that reads `dueAt`. */
    CUSTOM_SCHEDULED: 'customScheduled',
} as const;
export type BufferPostMode = (typeof BufferPostMode)[keyof typeof BufferPostMode];

export const BUFFER_POST_MODES = Object.values(BufferPostMode);

/**
 * Buffer's `ShareMode` enum: `addToQueue | shareNext | shareNow |
 * customScheduled`. Two of the four differ from the values above, and sending
 * ours got the whole mutation rejected at validation:
 *
 *   Variable "$input" got invalid value "now" at "input.mode";
 *   Value "now" does not exist in "ShareMode" enum.
 *
 * Translating here rather than renaming `BufferPostMode` keeps the mode out of
 * Buffer's vocabulary everywhere else — the DTO's accepted values, the pushes
 * already recorded on `socialMediaPostPush.mode`, and the i18n keys the
 * composer's dropdown is built from all stay as they are.
 */
const SHARE_MODE: Record<BufferPostMode, string> = {
    [BufferPostMode.ADD_TO_QUEUE]: 'addToQueue',
    [BufferPostMode.NOW]: 'shareNow',
    [BufferPostMode.NEXT]: 'shareNext',
    [BufferPostMode.CUSTOM_SCHEDULED]: 'customScheduled',
};

/**
 * Networks whose metadata carries a required post type, and the type to send.
 *
 * Facebook rejects a post without one — "Invalid post: Facebook posts require a
 * type (post, story, or reel)" — because `FacebookPostMetadataInput.type` is
 * `PostTypeFacebook!`. `post` is the ordinary feed post; `reel` and `story` are
 * the other two and would need composer support, as their asset rules differ.
 *
 * LinkedIn and Twitter have no required type, and sending metadata Buffer did
 * not ask for is its own way to be rejected, so they are absent here rather
 * than mapped to a default. Instagram is missing on purpose: its metadata needs
 * `shouldShareToFeed` as well, which changes where the post appears, so it is
 * left to whoever connects an Instagram channel and can test it.
 */
const REQUIRED_POST_TYPE: Record<string, string> = {
    facebook: 'post',
};

export interface BufferChannel {
    id: string;
    name: string | null;
    service: string | null;
    avatar: string | null;
    isQueuePaused: boolean | null;
}

export interface BufferCreatePostInput {
    channelId: string;
    text: string;
    mode: BufferPostMode;
    /** ISO 8601. Required by `customScheduled` and ignored by every other mode. */
    dueAt?: string | null;
    /** Public URL — Buffer fetches the file itself, there is no upload API. */
    imageUrl?: string | null;
    /**
     * The channel's network, as `listChannels` reports it. Some networks reject
     * a post that does not declare a type — see `REQUIRED_POST_TYPE`.
     */
    service?: string | null;
}

export interface BufferCreatePostResult {
    id: string | null;
    dueAt: string | null;
    status: string | null;
}

/**
 * `OrganizationId` is a custom scalar in Buffer's schema, not `String`. GraphQL
 * validates variable declarations by exact type, so declaring `String!` here is
 * rejected before execution even though the value sent is an ordinary string.
 */
const CHANNELS_QUERY = `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      service
      avatar
      isQueuePaused
    }
  }
`;

/**
 * `... on MutationError` is the important half: Buffer models failures as union
 * members rather than GraphQL errors, so a mutation that only selects the
 * success type returns `{}` on a rejection and looks like it worked.
 */
const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          dueAt
          status
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

/** Buffer is a third party — never let a hung request hold a page open. */
const REQUEST_TIMEOUT_MS = 20_000;

@Injectable()
export class BufferService {
    private readonly logger = new Logger(BufferService.name);

    constructor(private readonly platformSettings: PlatformSettingsService) {}

    /** Credentials as configured, with no assertion that they are usable. */
    async getConfig(): Promise<{
        accessToken: string | null;
        organizationId: string | null;
        apiUrl: string;
        defaultChannelId: string | null;
    }> {
        const [accessToken, organizationId, apiUrl, defaultChannelId] = await Promise.all([
            this.platformSettings.getRawValue('social_buffer', 'access_token'),
            this.platformSettings.getRawValue('social_buffer', 'organization_id'),
            this.platformSettings.getRawValue('social_buffer', 'api_url'),
            this.platformSettings.getRawValue('social_buffer', 'default_channel_id'),
        ]);

        return {
            accessToken: accessToken || process.env.BUFFER_ACCESS_TOKEN || null,
            organizationId: organizationId || process.env.BUFFER_ORGANIZATION_ID || null,
            apiUrl: apiUrl || BUFFER_DEFAULT_API_URL,
            defaultChannelId: defaultChannelId || null,
        };
    }

    async isConfigured(): Promise<boolean> {
        const { accessToken, organizationId } = await this.getConfig();
        return Boolean(accessToken && organizationId);
    }

    /**
     * Connected channels — the Facebook page, LinkedIn company, and so on.
     *
     * The composer needs these to offer a target, and they are the only way to
     * turn "post to Facebook" into the channel id `createPost` requires.
     */
    async listChannels(): Promise<BufferChannel[]> {
        const { organizationId } = await this.requireConfig();
        const data = await this.request<{ channels: BufferChannel[] }>(CHANNELS_QUERY, {
            organizationId,
        });
        return data.channels ?? [];
    }

    /** Channels for one network, e.g. every connected Facebook page. */
    async listChannelsForService(service: string): Promise<BufferChannel[]> {
        const channels = await this.listChannels();
        return channels.filter((channel) => channel.service?.toLowerCase() === service.toLowerCase());
    }

    async createPost(input: BufferCreatePostInput): Promise<BufferCreatePostResult> {
        await this.requireConfig();

        if (input.mode === BufferPostMode.CUSTOM_SCHEDULED && !input.dueAt) {
            throw new BadRequestException('A scheduled Buffer post needs a date and time.');
        }

        const payload: Record<string, unknown> = {
            channelId: input.channelId,
            text: input.text,
            // Buffer publishes rather than sending the operator a reminder to
            // publish by hand; `notification` is the other value and would make
            // this feature pointless.
            schedulingType: 'automatic',
            mode: SHARE_MODE[input.mode],
        };
        if (input.mode === BufferPostMode.CUSTOM_SCHEDULED && input.dueAt) {
            payload.dueAt = input.dueAt;
        }
        if (input.imageUrl) {
            payload.assets = [{ image: { url: input.imageUrl } }];
        }

        const service = input.service?.toLowerCase();
        const postType = service ? REQUIRED_POST_TYPE[service] : undefined;
        if (postType) {
            payload.metadata = { [service as string]: { type: postType } };
        }

        const data = await this.request<{
            createPost: {
                __typename?: string;
                post?: { id?: string; dueAt?: string; status?: string };
                message?: string;
            };
        }>(CREATE_POST_MUTATION, { input: payload });

        const result = data.createPost;
        if (!result) {
            throw new BadRequestException('Buffer returned an empty response.');
        }
        if (result.message) {
            // A union error, not a transport failure — the message is written for
            // a human, so it is surfaced rather than replaced.
            throw new BadRequestException(`Buffer rejected the post: ${result.message}`);
        }
        if (!result.post) {
            throw new BadRequestException(
                `Buffer returned an unexpected response${result.__typename ? ` (${result.__typename})` : ''}.`,
            );
        }

        return {
            id: result.post.id ?? null,
            dueAt: result.post.dueAt ?? null,
            status: result.post.status ?? null,
        };
    }

    private async requireConfig() {
        const config = await this.getConfig();
        if (!config.accessToken || !config.organizationId) {
            throw new BadRequestException(
                'Buffer is not configured. Add an API key and organisation ID under Platform Settings → Buffer.',
            );
        }
        return config as {
            accessToken: string;
            organizationId: string;
            apiUrl: string;
            defaultChannelId: string | null;
        };
    }

    private async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const { accessToken, apiUrl } = await this.requireConfig();

        let response: Response;
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            this.logger.error(`Buffer request failed: ${(error as Error).message}`);
            throw new BadRequestException(`Could not reach Buffer: ${(error as Error).message}`);
        }

        const text = await response.text();
        let body: any;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            throw new BadRequestException(
                `Buffer returned a non-JSON response (HTTP ${response.status}).`,
            );
        }

        // Validation fails once per bad position, so reporting only the first
        // error hides the rest — and each hidden one costs another round trip
        // to discover.
        const errors: string[] = Array.isArray(body?.errors)
            ? body.errors.map((e: any) => e?.message).filter(Boolean)
            : [];

        // GraphQL answers 200 with an `errors` array for most failures, so the
        // status code alone is not enough to decide this call succeeded.
        if (!response.ok) {
            const message = errors.length > 0 ? errors.join(' | ') : `HTTP ${response.status}`;
            throw new BadRequestException(`Buffer request failed: ${message}`);
        }
        if (errors.length > 0) {
            throw new BadRequestException(`Buffer request failed: ${errors.join(' | ')}`);
        }
        if (!body?.data) {
            throw new BadRequestException('Buffer returned no data.');
        }

        return body.data as T;
    }
}
