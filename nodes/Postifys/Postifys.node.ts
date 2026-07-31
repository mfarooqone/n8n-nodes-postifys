import { setTimeout as delay } from 'timers/promises';
import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

type PostifysCredentials = {
	serverUrl: string;
	apiKey: string;
};

type PostifysApiError = {
	message?: string;
	response?: {
		statusCode?: number;
		body?: {
			error?: string;
			message?: string;
			code?: string;
		};
	};
};

const POST_REQUEST_TIMEOUT_MS = 60 * 1000;
const MEDIA_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const STATUS_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const MEDIA_STATUS_POLL_INTERVAL_MS = 3 * 1000;

const BLOCKED_DIRECT_URL_PATTERNS = /drive\.google\.com|dropbox\.com|dropboxusercontent\.com/i;
const REDNOTE_TEMP_MEDIA_PATTERN = /^https?:\/\/rednote\.postifys\.com\/media\/temp\//i;

const trimTrailingSlash = (value: string) => String(value || '').replace(/\/$/, '');

const normalizeMediaUrls = (value: string | string[] | unknown): string[] => {
	if (Array.isArray(value)) {
		return value.map((item) => String(item || '').trim()).filter(Boolean);
	}
	return String(value || '')
		.split(/\r?\n|,/)
		.map((item) => item.trim())
		.filter(Boolean);
};

const firstString = (...values: unknown[]): string => {
	for (const value of values) {
		const text = String(value || '').trim();
		if (text) return text;
	}
	return '';
};

const itemField = (item: INodeExecutionData, fieldName: string): unknown => {
	if (!fieldName) return '';
	return (item.json as Record<string, unknown>)[fieldName];
};

const sleep = async (ms: number): Promise<void> => {
	await delay(ms);
};

const isRednoteTempMediaUrl = (url: string): boolean => REDNOTE_TEMP_MEDIA_PATTERN.test(String(url || '').trim());

const parsePostifysError = (error: unknown) => {
	const apiError = error as PostifysApiError;
	const body = apiError.response?.body || {};
	const statusCode = apiError.response?.statusCode;
	const code = body.code || (statusCode ? `HTTP_${statusCode}` : 'POSTIFYS_REQUEST_FAILED');
	const message = body.error || body.message || apiError.message || 'Postifys request failed.';
	return { message, code };
};

const connectionLoadErrorOption = (error: unknown): INodePropertyOptions[] => {
	const parsed = parsePostifysError(error);
	return [{
		name: `Could not load Postifys accounts: ${parsed.message}`,
		value: '',
		description: `${parsed.code}. Check the Postifys API key and Server URL, then reload this dropdown.`,
	}];
};

const assertDirectMediaUrls = (
	node: INode,
	itemIndex: number,
	urls: string[],
	label = 'Media URL',
) => {
	for (const url of urls) {
		if (BLOCKED_DIRECT_URL_PATTERNS.test(url)) {
			throw new NodeOperationError(
				node,
				`${label} cannot use Google Drive or Dropbox links directly. Add Media > Upload first, then use the returned url.`,
				{ itemIndex },
			);
		}
	}
};

const assertAccountId = (
	node: INode,
	itemIndex: number,
	value: string,
	label: string,
) => {
	if (!String(value || '').trim()) {
		throw new NodeOperationError(
			node,
			`${label} is required. Reconnect the account in Postifys and reload the dropdown.`,
			{ itemIndex },
		);
	}
};

const getConnections = async (context: ILoadOptionsFunctions): Promise<any[]> => {
	const credentials = await context.getCredentials('postifysApi') as PostifysCredentials;
	const baseURL = trimTrailingSlash(credentials.serverUrl);
	const response = await context.helpers.httpRequestWithAuthentication.call(context, 'postifysApi', {
		method: 'GET',
		baseURL,
		url: '/api/connections',
		json: true,
		timeout: STATUS_REQUEST_TIMEOUT_MS,
	});
	return Array.isArray(response.connections) ? response.connections : [];
};

const connectionOptions = async (
	context: ILoadOptionsFunctions,
	platform: string,
	emptyName: string,
	emptyDescription: string,
	mapName: (connection: any) => string,
): Promise<INodePropertyOptions[]> => {
	try {
		const connections = await getConnections(context);
		const filtered = connections.filter((connection) => connection.platform === platform);
		if (!filtered.length) {
			return [{ name: emptyName, value: '', description: emptyDescription }];
		}
		return filtered.map((connection) => ({
			name: mapName(connection),
			value: connection.id,
			description: connection.status === 'reconnect_required' ? 'Reconnect required in Postifys.' : undefined,
		}));
	} catch (error) {
		return connectionLoadErrorOption(error);
	}
};

const getPostId = (response: Record<string, unknown>): string => {
	const data = (response.data || {}) as Record<string, unknown>;
	return firstString(
		response.postId,
		response.postSubmissionId,
		response.historyId,
		response.id,
		data.postSubmissionId,
		data.postId,
		data.id,
		data.publish_id,
		data.video_id,
		data.media_id,
	);
};

export const normalizePostifysResult = (
	platform: string,
	operation: string,
	response: Record<string, unknown>,
) => {
	const data = (response.data || {}) as Record<string, unknown>;
	const status = firstString(response.status, data.status);
	const normalizedStatus = status.toLowerCase();
	const accepted = response.accepted === true || normalizedStatus === 'queued';
	const isTikTokSuccess = platform === 'tiktok' && [
		'publish_complete',
		'send_to_user_inbox',
		'upload_complete',
	].includes(normalizedStatus);
	const isPublished = normalizedStatus === 'published' || isTikTokSuccess;
	const isFailed = normalizedStatus === 'failed';
	const isComplete = isPublished || isFailed;
	const parts = Array.isArray(response.parts)
		? response.parts
		: (Array.isArray(data.parts) ? data.parts : null);
	const partProgress = parts ? {
		parts,
		partsTotal: Number(response.partsTotal ?? data.partsTotal ?? parts.length) || parts.length,
		partsReady: Number(response.partsReady ?? data.partsReady) || 0,
		partsPublished: Number(response.partsPublished ?? data.partsPublished) || 0,
		partsFailed: Number(response.partsFailed ?? data.partsFailed) || 0,
		currentPart: Number(response.currentPart ?? data.currentPart) || 0,
	} : {};
	const items = Array.isArray(response.items)
		? response.items
		: (Array.isArray(data.items) ? data.items : null);
	const carousels = Array.isArray(response.carousels)
		? response.carousels
		: (Array.isArray(data.carousels) ? data.carousels : null);
	const mode = firstString(response.mode, data.mode);
	const carouselProgress = mode === 'carousel' || items || carousels ? {
		mode: mode || 'carousel',
		items: items || [],
		itemsTotal: Number(response.itemsTotal ?? data.itemsTotal ?? items?.length ?? 0) || items?.length || 0,
		itemsReady: Number(response.itemsReady ?? data.itemsReady) || 0,
		itemsFailed: Number(response.itemsFailed ?? data.itemsFailed) || 0,
		currentItem: Number(response.currentItem ?? data.currentItem) || 0,
		carousels: carousels || [],
		carouselsTotal: Number(response.carouselsTotal ?? data.carouselsTotal ?? carousels?.length ?? 0) || carousels?.length || 0,
		carouselsReady: Number(response.carouselsReady ?? data.carouselsReady) || 0,
		carouselsPublished: Number(response.carouselsPublished ?? data.carouselsPublished) || 0,
		currentCarousel: Number(response.currentCarousel ?? data.currentCarousel) || 0,
		parentContainerId: firstString(response.parentContainerId, data.parentContainerId),
		publishedMediaId: firstString(response.publishedMediaId, data.publishedMediaId),
	} : {};

	const postMode = firstString(data.post_mode, response.postMode);
	const collaborators = Array.isArray(response.collaborators)
		? response.collaborators
		: (Array.isArray(data.collaborators) ? data.collaborators : null);
	const collaboratorInvites = Array.isArray(response.collaboratorInvites)
		? response.collaboratorInvites
		: (Array.isArray(data.collaboratorInvites) ? data.collaboratorInvites : null);
	const collaboratorSummary = (collaborators || collaboratorInvites)
		? {
			...(collaborators ? { collaborators } : {}),
			...(collaboratorInvites ? { collaboratorInvites } : {}),
		}
		: {};

	return {
		success: response.success !== false,
		platform,
		operation,
		postId: getPostId(response),
		status: status || (accepted ? 'queued' : ''),
		stage: firstString(response.stage, data.stage),
		accepted,
		isComplete,
		shouldPoll: accepted || ['queued', 'pending', 'processing', 'processing_upload', 'processing_download'].includes(normalizedStatus),
		published: isPublished,
		failed: isFailed,
		failureReason: firstString(response.failureReason, response.error, data.failureReason, data.error),
		url: firstString(response.url, response.link, data.url, data.link),
		historyId: firstString(response.historyId, response.postId, response.postSubmissionId),
		...(postMode ? { postMode } : {}),
		...partProgress,
		...carouselProgress,
		...collaboratorSummary,
		raw: response,
	};
};

const inputMediaUrl = (item: INodeExecutionData): string => firstString(
	item.json.serve_url,
	item.json.serveUrl,
	item.json.media_url,
	item.json.mediaUrl,
	item.json.direct_url,
	item.json.directUrl,
);

const inputSourceUrl = (item: INodeExecutionData): string => firstString(
	item.json.source_url,
	item.json.sourceUrl,
	item.json.drive_link,
	item.json.driveLink,
	item.json.url,
	item.json.path,
);

const inputTitle = (item: INodeExecutionData): string => firstString(
	item.json.title,
	item.json.caption,
	item.json.current_title,
	item.json.file_name,
);

const uploadedMediaUrl = (response: Record<string, unknown>): string => firstString(
	response.url,
	response.media_url,
	response.mediaUrl,
	response.serve_url,
	response.serveUrl,
	response.direct_url,
	response.directUrl,
	(response.data as Record<string, unknown> | undefined)?.url,
	(response.data as Record<string, unknown> | undefined)?.media_url,
	(response.data as Record<string, unknown> | undefined)?.serve_url,
);

const uploadedMediaName = (response: Record<string, unknown>): string => firstString(
	response.name,
	response.filename,
	response.file_name,
	(response.data as Record<string, unknown> | undefined)?.name,
	(response.data as Record<string, unknown> | undefined)?.filename,
	(response.data as Record<string, unknown> | undefined)?.file_name,
);

const normalizeUploadedMediaResult = (
	response: Record<string, unknown>,
) => {
	const serveUrl = uploadedMediaUrl(response);
	return {
		name: uploadedMediaName(response),
		serve_url: serveUrl,
	};
};

const queuePostifysMediaUpload = async (
	context: IExecuteFunctions,
	baseURL: string,
	sourceUrl: string,
	filename: string,
	itemIndex: number,
): Promise<Record<string, unknown>> => {
	const queued = await context.helpers.httpRequestWithAuthentication.call(context, 'postifysApi', {
		method: 'POST',
		baseURL,
		url: '/api/media/queue',
		body: {
			url: sourceUrl,
			type: 'any',
			...(filename ? { filename } : {}),
		},
		json: true,
		timeout: STATUS_REQUEST_TIMEOUT_MS,
	}) as Record<string, unknown>;

	const mediaJobId = firstString(queued.mediaJobId, queued.jobId, queued.id);
	if (!mediaJobId) {
		throw new NodeOperationError(context.getNode(), 'Postifys media queue did not return a mediaJobId.', { itemIndex });
	}

	const startedAt = Date.now();
	let latest = queued;
	while (Date.now() - startedAt < MEDIA_UPLOAD_TIMEOUT_MS) {
		const status = firstString(latest.status).toLowerCase();
		if (status === 'completed') {
			if (!uploadedMediaUrl(latest)) {
				throw new NodeOperationError(context.getNode(), 'Postifys media job completed without a serve_url.', { itemIndex });
			}
			return latest;
		}
		if (status === 'failed') {
			const reason = firstString(latest.failureReason, latest.error, latest.message) || 'Postifys media upload failed.';
			throw new NodeOperationError(context.getNode(), reason, { itemIndex });
		}

		await sleep(MEDIA_STATUS_POLL_INTERVAL_MS);
		latest = await context.helpers.httpRequestWithAuthentication.call(context, 'postifysApi', {
			method: 'GET',
			baseURL,
			url: '/api/media/status',
			qs: { mediaJobId },
			json: true,
			timeout: STATUS_REQUEST_TIMEOUT_MS,
		}) as Record<string, unknown>;
	}

	throw new NodeOperationError(context.getNode(), 'Timed out waiting for Postifys media upload to complete.', { itemIndex });
};

export const __postifysTestUtils = {
	normalizeMediaUrls,
	normalizePostifysResult,
	normalizeUploadedMediaResult,
	isRednoteTempMediaUrl,
};

export class Postifys implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postifys',
		name: 'postifys',
		icon: 'file:postifys.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["resource"] === "media" ? $parameter["operation"] : $parameter["platform"]}}',
		description: 'Upload media to a direct URL, then publish Facebook, Instagram, YouTube, Pinterest, LinkedIn, and TikTok posts through Postifys',
		defaults: {
			name: 'Postifys',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'postifysApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Media', value: 'media' },
					{ name: 'Post', value: 'post' },
				],
				default: 'media',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['media'] } },
				options: [
					{
						name: 'Upload',
						value: 'uploadFromUrl',
						description: 'Upload an image or video URL to Postifys and return a hosted media URL',
						action: 'Upload media',
					},
					{
						name: 'Ensure Uploaded URL',
						value: 'ensureMediaUrl',
						description: 'Reuse an existing hosted URL from the input, or upload the URL if one is missing',
						action: 'Ensure uploaded media URL',
					},
				],
				default: 'uploadFromUrl',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a post' },
					{ name: 'Get Status', value: 'getStatus', action: 'Get post status' },
				],
				default: 'create',
			},
			{
				displayName: 'Auto Map Input Fields',
				name: 'rednoteBatchMode',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['media'],
						operation: ['ensureMediaUrl'],
					},
				},
				default: true,
				description: 'Whether to reuse common input fields like URL, media_url, serve_url, source_url, drive_link, path, and file_name',
			},
			{
				displayName: 'URL',
				name: 'sourceUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['media'],
						operation: ['uploadFromUrl', 'ensureMediaUrl'],
					},
				},
				default: '',
				placeholder: '={{ $json.url }}',
				required: true,
				description: 'Image or video URL to upload. This can be a direct media URL, Google Drive link, Dropbox link, S3/CDN URL, or another remote media URL.',
			},
			{
				displayName: 'Skip Item If URL Is Missing',
				name: 'skipMissingMedia',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['media'],
						operation: ['uploadFromUrl', 'ensureMediaUrl'],
					},
				},
				default: true,
				description: 'Whether to output a skipped item instead of failing the workflow when an item has no URL',
			},
			{
				displayName: 'Status Endpoint Path',
				name: 'statusPath',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['getStatus'],
					},
				},
				default: '/api/posts/status',
				description: 'GET endpoint path used to check status. The node adds postId and platform as query parameters.',
			},
			{
				displayName: 'Post ID',
				name: 'postId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['getStatus'],
					},
				},
				default: '={{ $json.postId || $json.historyId || $json.publish_id }}',
				required: true,
				description: 'Postifys history ID or platform post/publish ID returned by Create',
			},
			{
				displayName: 'Platform',
				name: 'statusPlatform',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['getStatus'],
					},
				},
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: 'instagram',
				description: 'Platform associated with the post ID',
			},
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
					},
				},
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'Pinterest', value: 'pinterest' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube', value: 'youtube' },
				],
				default: 'facebook',
				description: 'Social platform to publish to',
			},
			{
				displayName: 'Auto Map Input Fields',
				name: 'rednotePostBatchMode',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
					},
				},
				default: true,
				description: 'Whether blank post fields should fall back to common input fields like URL, media_url, serve_url, title, and caption',
			},
			{
				displayName: 'Skip Item If Media URL Is Missing',
				name: 'skipMissingPostMedia',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						rednotePostBatchMode: [true],
					},
				},
				default: true,
				description: 'Whether media post rows without a media URL should be skipped instead of failing',
			},
			{
				displayName: 'Facebook Page Name or ID',
				name: 'pageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFacebookPages' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Instagram Account Name or ID',
				name: 'instagramAccountId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getInstagramAccounts' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['instagram'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'TikTok Account Name or ID',
				name: 'tiktokAccountId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTikTokAccounts' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'TikTok Publishing Method',
				name: 'tiktokPostMode',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
					},
				},
				options: [
					{
						name: 'Direct Post',
						value: 'direct',
						description: 'Publish directly to the selected TikTok profile',
					},
					{
						name: 'Send as Draft',
						value: 'inbox',
						description: 'Upload to the TikTok inbox for further editing and manual publishing',
					},
				],
				default: 'direct',
				description: 'Choose how this individual video is delivered to TikTok',
			},
			{
				displayName: 'Facebook Post Mode',
				name: 'facebookPostMode',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook'],
					},
				},
				options: [
					{ name: 'Feed (Text / Link)', value: 'FEED' },
					{ name: 'Image', value: 'IMAGE' },
					{ name: 'Video / Reel', value: 'REEL' },
					{ name: 'Story', value: 'STORIES' },
				],
				default: 'REEL',
				description: 'Choose Feed for text or link posts, Image for native photos, Video / Reel for Facebook Reels, or Story for Page Stories (plain media; requires META_STORIES_ENABLED on Postifys)',
			},
			{
				displayName: 'YouTube Channel Name or ID',
				name: 'channelId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getYouTubeChannels' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Pinterest Account Name or ID',
				name: 'pinterestUserId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPinterestAccounts' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Pinterest Board Name or ID',
				name: 'boardId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPinterestBoards' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'LinkedIn Account Name or ID',
				name: 'linkedinUserId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLinkedInAccounts' },
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
					},
				},
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'LinkedIn Post Type',
				name: 'linkedinPostType',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
					},
				},
				options: [
					{ name: 'Text', value: 'text' },
					{ name: 'Image', value: 'image' },
					{ name: 'Video', value: 'video' },
					{ name: 'Link Preview', value: 'link' },
				],
				default: 'image',
				description: 'Choose Image or Video to upload native LinkedIn media. Link Preview renders a URL card.',
			},
			{
				displayName: 'Media Type',
				name: 'mediaType',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['instagram'],
					},
				},
				options: [
					{ name: 'Image', value: 'IMAGE' },
					{ name: 'Video / Reel', value: 'REEL' },
					{ name: 'Story', value: 'STORIES' },
				],
				default: 'IMAGE',
				description: 'Choose Image for photo posts, Video / Reel for Instagram Reels, or Story for Instagram Stories (plain media; caption ignored; requires META_STORIES_ENABLED on Postifys)',
			},
			{
				displayName: 'Collaborators',
				name: 'collaborators',
				type: 'string',
				typeOptions: { rows: 2 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['instagram'],
						mediaType: ['REEL'],
					},
				},
				default: '',
				description: 'Optional Instagram usernames to invite as Reel collaborators (up to 3). Comma or newline separated. Leading @ is stripped',
			},
			{
				displayName: 'Collaborators',
				name: 'collaborators',
				type: 'string',
				typeOptions: { rows: 2 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook'],
						facebookPostMode: ['REEL'],
					},
				},
				default: '',
				description: 'Optional Facebook Page IDs to invite as Reel collaborators (up to 10). Comma or newline separated.',
			},
			{
				displayName: 'Post Asynchronously',
				name: 'asyncPublish',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
					},
				},
				default: true,
				description: 'Whether to return a postId immediately and let Postifys finish uploading/publishing in the background. Use Get Status later if you need the final result. Turn off to wait until the platform publish completes',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook', 'instagram', 'linkedin'],
					},
				},
				default: '',
				description: 'Post text or caption. With Auto Map Input Fields enabled, blank text falls back to input title or caption.',
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				default: '',
				description: 'TikTok video caption. With Auto Map Input Fields enabled, blank caption falls back to input title or caption.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube', 'pinterest', 'linkedin'],
					},
				},
				default: '',
				description: 'YouTube video title, Pinterest pin title, or optional LinkedIn link title',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube', 'pinterest'],
					},
				},
				default: '',
				description: 'YouTube video description or Pinterest pin description',
			},
			{
				displayName: 'Link',
				name: 'link',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				placeholder: 'https://example.com',
				description: 'Optional destination URL for the Pinterest pin',
			},
			{
				displayName: 'Link',
				name: 'linkedinLink',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
						linkedinPostType: ['link'],
					},
				},
				default: '',
				placeholder: 'https://example.com',
				description: 'URL for a LinkedIn link preview card',
			},
			{
				displayName: 'Media URLs',
				name: 'mediaUrls',
				type: 'string',
				typeOptions: { rows: 3 },
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook', 'instagram'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media > Upload. One URL per line or comma-separated.',
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media > Upload',
			},
			{
				displayName: 'Image URL',
				name: 'linkedinImageUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
						linkedinPostType: ['image'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media > Upload',
			},
			{
				displayName: 'Video URL',
				name: 'linkedinVideoUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
						linkedinPostType: ['video'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media > Upload',
			},
			{
				displayName: 'Video URL',
				name: 'videoUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube', 'tiktok'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media > Upload',
			},
			{
				displayName: 'Thumbnail URL',
				name: 'thumbnailUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: '',
				placeholder: 'https://example.com/thumbnail.jpg',
				description: 'Optional public image URL for the YouTube custom thumbnail',
			},
			{
				displayName: 'Privacy Status',
				name: 'privacyStatus',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				options: [
					{ name: 'Private', value: 'private' },
					{ name: 'Unlisted', value: 'unlisted' },
					{ name: 'Public', value: 'public' },
				],
				default: 'private',
				description: 'Visibility for the uploaded YouTube video',
			},
			{
				displayName: 'TikTok Privacy',
				name: 'tiktokPrivacy',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				options: [
					{ name: 'Public to Everyone', value: 'PUBLIC_TO_EVERYONE' },
					{ name: 'Mutual Follow Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
					{ name: 'Self Only', value: 'SELF_ONLY' },
				],
				default: 'PUBLIC_TO_EVERYONE',
				description: 'Used for Direct Post (video.publish). With video.upload (inbox draft), TikTok delivers a draft to the creator inbox and final visibility is set in the TikTok app.',
			},
			{
				displayName: 'Disable TikTok Comments',
				name: 'disableComment',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				default: false,
			},
			{
				displayName: 'Disable TikTok Duet',
				name: 'disableDuet',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				default: false,
			},
			{
				displayName: 'Disable TikTok Stitch',
				name: 'disableStitch',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				default: false,
			},
			{
				displayName: 'I Confirm This Direct Post',
				name: 'tiktokDirectPostConsent',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
						tiktokPostMode: ['direct'],
					},
				},
				default: false,
				description: 'Confirm that you reviewed the selected creator, caption, privacy, and interaction settings and want to publish now',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: '',
				placeholder: 'postifys, automation',
				description: 'Comma-separated YouTube tags',
			},
			{
				displayName: 'Category ID',
				name: 'categoryId',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: '22',
				description: 'YouTube video category ID. 22 is People & Blogs.',
			},
			{
				displayName: 'Notify Subscribers',
				name: 'notifySubscribers',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: false,
				description: 'Whether YouTube should notify channel subscribers',
			},
		],
	};

	methods = {
		loadOptions: {
			async getFacebookPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'facebook',
					'No Facebook Pages found. Reconnect Meta in Postifys.',
					'Open Postifys, connect Facebook again, then reload this dropdown.',
					(page) => page.name || page.id,
				);
			},

			async getInstagramAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'instagram',
					'No Instagram accounts found. Reconnect Meta in Postifys.',
					'Open Postifys, connect Instagram/Facebook again, then reload this dropdown.',
					(instagram) => instagram.username ? `@${instagram.username}` : instagram.name || instagram.id,
				);
			},

			async getYouTubeChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'youtube',
					'No YouTube channels found. Connect YouTube in Postifys.',
					'Open Postifys, connect YouTube, then reload this dropdown.',
					(channel) => channel.name || channel.id,
				);
			},

			async getPinterestAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'pinterest',
					'No Pinterest accounts found. Connect Pinterest in Postifys.',
					'Open Postifys, connect Pinterest, then reload this dropdown.',
					(account) => account.username ? `@${account.username}` : account.name || account.id,
				);
			},

			async getPinterestBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
					const baseURL = trimTrailingSlash(credentials.serverUrl);
					const pinterestUserId = String(this.getNodeParameter('pinterestUserId', 0) || '').trim();
					const uri = pinterestUserId
						? `/api/pinterest/boards?pinterestUserId=${encodeURIComponent(pinterestUserId)}`
						: '/api/pinterest/boards';
					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'postifysApi', {
						method: 'GET',
						baseURL,
						url: uri,
						json: true,
						timeout: STATUS_REQUEST_TIMEOUT_MS,
					});
					const boards = Array.isArray(response.boards) ? response.boards : [];
					if (!boards.length) {
						return [{
							name: 'No Pinterest Boards Found. Connect Pinterest In Postifys',
							value: '',
							description: 'Open Postifys, connect Pinterest, then reload this dropdown',
						}];
					}
					return boards.map((board: { id: string; name?: string }) => ({
						name: board.name || board.id,
						value: board.id,
					}));
				} catch (error) {
					return connectionLoadErrorOption(error);
				}
			},

			async getLinkedInAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'linkedin',
					'No LinkedIn accounts found. Connect LinkedIn in Postifys.',
					'Open Postifys, connect LinkedIn, then reload this dropdown.',
					(account) => account.email ? `${account.name || account.id} (${account.email})` : account.name || account.id,
				);
			},

			async getTikTokAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return connectionOptions(
					this,
					'tiktok',
					'No TikTok accounts found. Connect TikTok in Postifys.',
					'Open https://postifys.com/app, click TikTok under Add Account, authorize, then reload this dropdown.',
					(account) => account.username ? `@${account.username}` : account.name || account.id,
				);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
		const baseURL = trimTrailingSlash(credentials.serverUrl);

		for (let i = 0; i < items.length; i++) {
			try {
				const item = items[i];
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'media') {
					if (!['uploadFromUrl', 'ensureMediaUrl'].includes(operation)) {
						throw new NodeOperationError(this.getNode(), `Unsupported media operation: ${operation}`, { itemIndex: i });
					}

					const useRednoteBatch = this.getNodeParameter('rednoteBatchMode', i, true) as boolean;
					const sourceUrlField = this.getNodeParameter('sourceUrlField', i, 'drive_link') as string;
					const filenameField = this.getNodeParameter('filenameField', i, 'file_name') as string;
					const existingServeUrl = useRednoteBatch ? inputMediaUrl(item) : '';
					if (operation === 'ensureMediaUrl' && existingServeUrl && !isRednoteTempMediaUrl(existingServeUrl)) {
						returnData.push({
							json: {
								name: firstString(item.json.name, item.json.filename, item.json.file_name, inputTitle(item)),
								serve_url: existingServeUrl,
							},
							pairedItem: { item: i },
						});
						continue;
					}
					const sourceUrl = firstString(
						this.getNodeParameter('sourceUrl', i, ''),
						useRednoteBatch ? itemField(item, sourceUrlField) : '',
						useRednoteBatch ? inputSourceUrl(item) : '',
						isRednoteTempMediaUrl(existingServeUrl) ? existingServeUrl : '',
					);
					const uploadFilename = firstString(
						this.getNodeParameter('uploadFilename', i, ''),
						useRednoteBatch ? itemField(item, filenameField) : '',
						useRednoteBatch ? item.json.file_name : '',
					);

					if (!sourceUrl) {
						if (this.getNodeParameter('skipMissingMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									code: 'POSTIFYS_MEDIA_SOURCE_MISSING',
									error: 'No source URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), 'Source URL is required.', { itemIndex: i });
					}

					const responseData = await queuePostifysMediaUpload(this, baseURL, sourceUrl, uploadFilename, i);

					returnData.push({
						json: normalizeUploadedMediaResult(responseData),
						pairedItem: { item: i },
					});
					continue;
				}

				if (operation === 'getStatus') {
					const postId = String(this.getNodeParameter('postId', i, '') || '').trim();
					const platform = this.getNodeParameter('statusPlatform', i, 'instagram') as string;
					const statusPath = String(this.getNodeParameter('statusPath', i, '/api/posts/status') || '').trim();
					if (!postId) {
						throw new NodeOperationError(this.getNode(), 'Post ID is required.', { itemIndex: i });
					}
					const separator = statusPath.includes('?') ? '&' : '?';
					const responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'postifysApi', {
						method: 'GET',
						baseURL,
						url: `${statusPath}${separator}postId=${encodeURIComponent(postId)}&platform=${encodeURIComponent(platform)}`,
						json: true,
						timeout: STATUS_REQUEST_TIMEOUT_MS,
					}) as Record<string, unknown>;

					returnData.push({
						json: normalizePostifysResult(platform, 'getStatus', responseData),
						pairedItem: { item: i },
					});
					continue;
				}

				const platform = this.getNodeParameter('platform', i) as string;
				const asyncPublish = this.getNodeParameter('asyncPublish', i, true) as boolean;
				const rednoteBatch = this.getNodeParameter('rednotePostBatchMode', i, true) as boolean;
				const fallbackMediaUrl = rednoteBatch ? inputMediaUrl(item) : '';
				const fallbackTitle = rednoteBatch ? inputTitle(item) : '';
				let endpoint = '';
				let body: Record<string, unknown> = {};

				if (platform === 'facebook') {
					const pageId = this.getNodeParameter('pageId', i) as string;
					const facebookPostMode = this.getNodeParameter('facebookPostMode', i) as string;
					const text = firstString(this.getNodeParameter('text', i, ''), fallbackTitle);
					const mediaUrls = normalizeMediaUrls(firstString(this.getNodeParameter('mediaUrls', i, ''), fallbackMediaUrl));
					assertDirectMediaUrls(this.getNode(), i, mediaUrls, 'Media URLs');
					assertAccountId(this.getNode(), i, pageId, 'Facebook Page');

					if (!text && !mediaUrls.length) {
						throw new NodeOperationError(this.getNode(), 'Facebook posts require Text or Media URLs.', { itemIndex: i });
					}
					if ((facebookPostMode === 'IMAGE' || facebookPostMode === 'REEL' || facebookPostMode === 'STORIES') && !mediaUrls.length) {
						if (rednoteBatch && this.getNodeParameter('skipMissingPostMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									platform,
									code: 'POSTIFYS_MEDIA_URL_MISSING',
									error: 'No serve_url/media URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), `Media URLs are required for Facebook ${facebookPostMode.toLowerCase()} posts.`, { itemIndex: i });
					}

					endpoint = '/api/facebook/post';
					body = {
						pageId,
						type: mediaUrls.length ? facebookPostMode : 'FEED',
						text,
						mediaUrls,
						async: asyncPublish,
					};
					if (facebookPostMode === 'REEL') {
						const collaborators = String(this.getNodeParameter('collaborators', i, '') || '').trim();
						if (collaborators) {
							body.collaborators = collaborators;
						}
					}
				} else if (platform === 'instagram') {
					const instagramAccountId = this.getNodeParameter('instagramAccountId', i) as string;
					const mediaType = this.getNodeParameter('mediaType', i) as string;
					const text = firstString(this.getNodeParameter('text', i, ''), fallbackTitle);
					const mediaUrls = normalizeMediaUrls(firstString(this.getNodeParameter('mediaUrls', i, ''), fallbackMediaUrl));
					assertDirectMediaUrls(this.getNode(), i, mediaUrls, 'Media URLs');
					assertAccountId(this.getNode(), i, instagramAccountId, 'Instagram account');

					if (!mediaUrls.length) {
						if (rednoteBatch && this.getNodeParameter('skipMissingPostMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									platform,
									code: 'POSTIFYS_MEDIA_URL_MISSING',
									error: 'No serve_url/media URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), 'Instagram posts require Media URLs.', { itemIndex: i });
					}

					endpoint = '/api/instagram/post';
					body = {
						instagramAccountId,
						type: mediaType,
						text,
						mediaUrls,
						async: asyncPublish,
					};
					if (mediaType === 'REEL') {
						const collaborators = String(this.getNodeParameter('collaborators', i, '') || '').trim();
						if (collaborators) {
							body.collaborators = collaborators;
						}
					}
				} else if (platform === 'youtube') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const title = firstString(this.getNodeParameter('title', i, ''), fallbackTitle);
					const description = this.getNodeParameter('description', i, '') as string;
					const videoUrl = firstString(this.getNodeParameter('videoUrl', i, ''), fallbackMediaUrl);
					const thumbnailUrl = this.getNodeParameter('thumbnailUrl', i, '') as string;
					const privacyStatus = this.getNodeParameter('privacyStatus', i, 'private') as string;
					const tags = this.getNodeParameter('tags', i, '') as string;
					const categoryId = this.getNodeParameter('categoryId', i, '22') as string;
					const notifySubscribers = this.getNodeParameter('notifySubscribers', i, false) as boolean;
					assertAccountId(this.getNode(), i, channelId, 'YouTube Channel');

					if (!title) {
						throw new NodeOperationError(this.getNode(), 'YouTube posts require a Title.', { itemIndex: i });
					}
					if (!videoUrl) {
						if (rednoteBatch && this.getNodeParameter('skipMissingPostMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									platform,
									code: 'POSTIFYS_MEDIA_URL_MISSING',
									error: 'No serve_url/video URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), 'YouTube posts require a Video URL.', { itemIndex: i });
					}
					assertDirectMediaUrls(this.getNode(), i, [videoUrl], 'Video URL');
					if (String(thumbnailUrl || '').trim()) {
						assertDirectMediaUrls(this.getNode(), i, [String(thumbnailUrl).trim()], 'Thumbnail URL');
					}

					endpoint = '/api/youtube/post';
					body = {
						channelId,
						title,
						description,
						videoUrl,
						thumbnailUrl,
						privacyStatus,
						tags,
						categoryId,
						notifySubscribers,
						async: asyncPublish,
					};
				} else if (platform === 'pinterest') {
					const pinterestUserId = this.getNodeParameter('pinterestUserId', i) as string;
					const boardId = this.getNodeParameter('boardId', i) as string;
					const title = firstString(this.getNodeParameter('title', i, ''), fallbackTitle);
					const description = this.getNodeParameter('description', i, '') as string;
					const link = this.getNodeParameter('link', i, '') as string;
					const imageUrl = firstString(this.getNodeParameter('imageUrl', i, ''), fallbackMediaUrl);
					assertDirectMediaUrls(this.getNode(), i, [imageUrl], 'Image URL');
					assertAccountId(this.getNode(), i, pinterestUserId, 'Pinterest Account');
					assertAccountId(this.getNode(), i, boardId, 'Pinterest Board');

					if (!title) {
						throw new NodeOperationError(this.getNode(), 'Pinterest pins require a Title.', { itemIndex: i });
					}
					if (!imageUrl) {
						if (rednoteBatch && this.getNodeParameter('skipMissingPostMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									platform,
									code: 'POSTIFYS_MEDIA_URL_MISSING',
									error: 'No serve_url/image URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), 'Pinterest pins require an Image URL.', { itemIndex: i });
					}

					endpoint = '/api/pinterest/post';
					body = {
						pinterestUserId,
						boardId,
						title,
						description,
						link,
						imageUrl,
						async: asyncPublish,
					};
				} else if (platform === 'linkedin') {
					const linkedinUserId = this.getNodeParameter('linkedinUserId', i) as string;
					const linkedinPostType = this.getNodeParameter('linkedinPostType', i, 'image') as string;
					const text = firstString(this.getNodeParameter('text', i, ''), fallbackTitle);
					const title = firstString(this.getNodeParameter('title', i, ''), fallbackTitle);
					const link = this.getNodeParameter('linkedinLink', i, '') as string;
					const imageUrl = firstString(this.getNodeParameter('linkedinImageUrl', i, ''), fallbackMediaUrl);
					const videoUrl = firstString(this.getNodeParameter('linkedinVideoUrl', i, ''), fallbackMediaUrl);
					assertAccountId(this.getNode(), i, linkedinUserId, 'LinkedIn Account');

					if (!text) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn posts require Text.', { itemIndex: i });
					}
					if (linkedinPostType === 'image' && !imageUrl) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn image posts require Image URL.', { itemIndex: i });
					}
					if (linkedinPostType === 'video' && !videoUrl) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn video posts require Video URL.', { itemIndex: i });
					}
					if (linkedinPostType === 'image') {
						assertDirectMediaUrls(this.getNode(), i, [imageUrl], 'Image URL');
					}
					if (linkedinPostType === 'video') {
						assertDirectMediaUrls(this.getNode(), i, [videoUrl], 'Video URL');
					}
					if (linkedinPostType === 'link' && !String(link || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn link preview posts require Link.', { itemIndex: i });
					}

					endpoint = '/api/linkedin/post';
					body = {
						linkedinUserId,
						postType: linkedinPostType,
						text,
						title,
						link,
						imageUrl,
						videoUrl,
						async: asyncPublish,
					};
				} else if (platform === 'tiktok') {
					const tiktokAccountId = this.getNodeParameter('tiktokAccountId', i) as string;
					const postMode = this.getNodeParameter('tiktokPostMode', i, 'direct') as string;
					const videoUrl = firstString(this.getNodeParameter('videoUrl', i, ''), fallbackMediaUrl);
					const caption = firstString(this.getNodeParameter('caption', i, ''), fallbackTitle);
					const privacy = this.getNodeParameter('tiktokPrivacy', i, 'PUBLIC_TO_EVERYONE') as string;
					const disableComment = this.getNodeParameter('disableComment', i, false) as boolean;
					const disableDuet = this.getNodeParameter('disableDuet', i, false) as boolean;
					const disableStitch = this.getNodeParameter('disableStitch', i, false) as boolean;
					const consent = postMode === 'direct'
						? this.getNodeParameter('tiktokDirectPostConsent', i, false) as boolean
						: false;
					assertAccountId(this.getNode(), i, tiktokAccountId, 'TikTok Account');

					if (postMode === 'direct' && !consent) {
						throw new NodeOperationError(
							this.getNode(),
							'Enable "I Confirm This Direct Post" after reviewing the TikTok creator and post settings.',
							{ itemIndex: i },
						);
					}

					if (!videoUrl) {
						if (rednoteBatch && this.getNodeParameter('skipMissingPostMedia', i, true) as boolean) {
							returnData.push({
								json: {
									success: false,
									skipped: true,
									platform,
									code: 'POSTIFYS_MEDIA_URL_MISSING',
									error: 'No serve_url/video URL found for this item.',
								},
								pairedItem: { item: i },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), 'TikTok posts require a Video URL.', { itemIndex: i });
					}
					assertDirectMediaUrls(this.getNode(), i, [videoUrl], 'Video URL');

					endpoint = '/api/tiktok/post';
					body = {
						tiktokAccountId,
						videoUrl,
						caption,
						privacy,
						disableComment,
						disableDuet,
						disableStitch,
						postMode,
						consent,
						async: asyncPublish,
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported platform: ${platform}`, { itemIndex: i });
				}

				const responseData = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'postifysApi',
					{
						method: 'POST',
						baseURL,
						url: endpoint,
						body,
						json: true,
						timeout: asyncPublish ? POST_REQUEST_TIMEOUT_MS : 20 * 60 * 1000,
					} as IHttpRequestOptions,
				) as Record<string, unknown>;

				returnData.push({
					json: normalizePostifysResult(platform, 'create', responseData),
					pairedItem: { item: i },
				});
			} catch (error) {
				const parsed = parsePostifysError(error);

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: parsed.message,
							code: parsed.code,
						},
						pairedItem: { item: i },
					});
					continue;
				}

				throw new NodeApiError(this.getNode(), error as { message: string }, {
					message: parsed.message,
					description: parsed.code,
				});
			}
		}

		return [returnData];
	}
}
