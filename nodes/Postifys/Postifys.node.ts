import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

type PostifysCredentials = {
	serverUrl: string;
	apiKey: string;
	mediaHostUrl?: string;
};

const normalizeMediaUrls = (value: string) => String(value || '')
	.split(/\r?\n|,/)
	.map((item) => item.trim())
	.filter(Boolean);

const BLOCKED_DIRECT_URL_PATTERNS = /drive\.google\.com|dropbox\.com|dropboxusercontent\.com/i;

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
				`${label} cannot use Google Drive or Dropbox links. Add Media → Upload from URL first, then use serve_url.`,
				{ itemIndex },
			);
		}
	}
};

const mediaHostUrl = (credentials: PostifysCredentials) => String(credentials.mediaHostUrl || 'https://rednote.postifys.com').replace(/\/$/, '');

const parsePostifysError = (error: unknown) => {
	const apiError = error as {
		message?: string;
		response?: { body?: { error?: string; code?: string } };
	};

	return {
		message: apiError.response?.body?.error || apiError.message || 'Postifys request failed.',
		code: apiError.response?.body?.code || 'POSTIFYS_REQUEST_FAILED',
	};
};

const assertAccountId = (
	node: INode,
	itemIndex: number,
	value: string,
	label: string,
) => {
	if (!String(value || '').trim()) {
		throw new NodeOperationError(node, `${label} is required. Reconnect Meta in Postifys and reload the dropdown.`, { itemIndex });
	}
};

const getConnections = async (context: ILoadOptionsFunctions): Promise<any[]> => {
	const credentials = await context.getCredentials('postifysApi') as PostifysCredentials;
	const baseURL = String(credentials.serverUrl || '').replace(/\/$/, '');
	const response = await context.helpers.requestWithAuthentication.call(context, 'postifysApi', {
		method: 'GET',
		baseURL,
		uri: '/api/connections',
		json: true,
	});
	return Array.isArray(response.connections) ? response.connections : [];
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
		inputs: ['main'],
		outputs: ['main'],
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
					{
						name: 'Media',
						value: 'media',
					},
					{
						name: 'Post',
						value: 'post',
					},
				],
				default: 'media',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['post'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a post',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['media'],
					},
				},
				options: [
					{
						name: 'Upload from URL',
						value: 'uploadFromUrl',
						description: 'Download Google Drive or other URLs to a direct MP4/image link. Auto-deletes after 15 minutes.',
						action: 'Upload media from URL',
					},
				],
				default: 'uploadFromUrl',
			},
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['media'],
						operation: ['uploadFromUrl'],
					},
				},
				default: '',
				placeholder: 'https://drive.google.com/uc?export=download&id=FILE_ID',
				description: 'Google Drive share/download link or any public media URL to re-host as a direct file',
				required: true,
			},
			{
				displayName: 'Filename',
				name: 'uploadFilename',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['media'],
						operation: ['uploadFromUrl'],
					},
				},
				default: '',
				placeholder: 'video.mp4',
				description: 'Optional filename hint when the source URL does not include one',
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
					{
						name: 'Facebook',
						value: 'facebook',
					},
					{
						name: 'Instagram',
						value: 'instagram',
					},
					{
						name: 'YouTube',
						value: 'youtube',
					},
					{
						name: 'Pinterest',
						value: 'pinterest',
					},
					{
						name: 'LinkedIn',
						value: 'linkedin',
					},
					{
						name: 'TikTok',
						value: 'tiktok',
					},
				],
				default: 'facebook',
				description: 'Social platform to publish to.',
			},
			{
				displayName: 'Facebook Page',
				name: 'pageId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getFacebookPages',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook'],
					},
				},
				default: '',
				description: 'Connected Facebook Page to publish to.',
			},
			{
				displayName: 'Instagram Account',
				name: 'instagramAccountId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getInstagramAccounts',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['instagram'],
					},
				},
				default: '',
				description: 'Connected Instagram professional account to publish to.',
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
					{
						name: 'Feed (Text / Link)',
						value: 'FEED',
					},
					{
						name: 'Image',
						value: 'IMAGE',
					},
					{
						name: 'Video / Reel',
						value: 'REEL',
					},
				],
				default: 'REEL',
				description: 'Choose Feed for text or link posts, Image for native photos, or Video / Reel for Facebook Reels.',
			},
			{
				displayName: 'YouTube Channel',
				name: 'channelId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getYouTubeChannels',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube'],
					},
				},
				default: '',
				description: 'Connected YouTube channel to upload to.',
			},
			{
				displayName: 'Pinterest Account',
				name: 'pinterestUserId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getPinterestAccounts',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				description: 'Connected Pinterest account to publish from.',
			},
			{
				displayName: 'Pinterest Board',
				name: 'boardId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getPinterestBoards',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['pinterest'],
					},
				},
				default: '',
				description: 'Connected Pinterest board to publish to.',
			},
			{
				displayName: 'LinkedIn Account',
				name: 'linkedinUserId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getLinkedInAccounts',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['linkedin'],
					},
				},
				default: '',
				description: 'Connected LinkedIn member account to publish to.',
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
					{
						name: 'Text',
						value: 'text',
					},
					{
						name: 'Image',
						value: 'image',
					},
					{
						name: 'Video',
						value: 'video',
					},
					{
						name: 'Link Preview',
						value: 'link',
					},
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
					{
						name: 'Image',
						value: 'IMAGE',
					},
					{
						name: 'Video / Reel',
						value: 'REEL',
					},
				],
				default: 'IMAGE',
				description: 'Choose Image for photo posts or Video / Reel for Instagram Reels.',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook', 'instagram', 'linkedin'],
					},
				},
				default: '',
				description: 'Post text or caption. For LinkedIn, Text is required.',
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
					},
				},
				default: '',
				description: 'TikTok video caption.',
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
				required: false,
				description: 'YouTube video title, Pinterest pin title, or optional LinkedIn link title.',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['youtube', 'pinterest'],
					},
				},
				default: '',
				description: 'YouTube video description or Pinterest pin description.',
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
				description: 'Optional destination URL for the Pinterest pin.',
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
				description: 'URL for a LinkedIn link preview card.',
			},
			{
				displayName: 'Media URLs',
				name: 'mediaUrls',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook', 'instagram'],
					},
				},
				default: '',
				placeholder: '={{ $json.serve_url }}',
				description: 'Use serve_url from Media → Upload from URL. One URL per line or comma-separated.',
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
				description: 'Use serve_url from Media → Upload from URL.',
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
				description: 'Use serve_url from Media → Upload from URL.',
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
				description: 'Use serve_url from Media → Upload from URL.',
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
				description: 'Use serve_url from Media → Upload from URL.',
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
				description: 'Optional public image URL for the YouTube custom thumbnail. If empty, YouTube uses an auto-generated frame.',
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
					{
						name: 'Private',
						value: 'private',
					},
					{
						name: 'Unlisted',
						value: 'unlisted',
					},
					{
						name: 'Public',
						value: 'public',
					},
				],
				default: 'private',
				description: 'Visibility for the uploaded YouTube video.',
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
				description: 'Comma-separated YouTube tags.',
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
				description: 'Whether YouTube should notify channel subscribers.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getFacebookPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const connections = await getConnections(this);
				const pages = connections.filter((c) => c.platform === 'facebook');
				if (!pages.length) {
					return [{
						name: 'No Facebook Pages found. Reconnect Meta in Postifys.',
						value: '',
						description: 'Open Postifys, connect Facebook again, then reload this dropdown.',
					}];
				}
				return pages.map((page: { id: string; name?: string }) => ({
					name: page.name || page.id,
					value: page.id,
				}));
			},

			async getInstagramAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const connections = await getConnections(this);
				const instagrams = connections.filter((c) => c.platform === 'instagram');
				if (!instagrams.length) {
					return [{
						name: 'No Instagram accounts found. Reconnect Meta in Postifys.',
						value: '',
						description: 'Open Postifys, connect Instagram/Facebook again, then reload this dropdown.',
					}];
				}
				return instagrams.map((instagram: { id: string; username?: string; name?: string }) => ({
					name: instagram.username ? `@${instagram.username}` : instagram.name || instagram.id,
					value: instagram.id,
				}));
			},

			async getYouTubeChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const connections = await getConnections(this);
				const channels = connections.filter((c) => c.platform === 'youtube');
				if (!channels.length) {
					return [{
						name: 'No YouTube channels found. Connect YouTube in Postifys.',
						value: '',
						description: 'Open Postifys, connect YouTube, then reload this dropdown.',
					}];
				}
				return channels.map((channel: { id: string; name?: string }) => ({
					name: channel.name || channel.id,
					value: channel.id,
				}));
			},

			async getPinterestAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const connections = await getConnections(this);
				const accounts = connections.filter((c) => c.platform === 'pinterest');
				if (!accounts.length) {
					return [{
						name: 'No Pinterest accounts found. Connect Pinterest in Postifys.',
						value: '',
						description: 'Open Postifys, connect Pinterest, then reload this dropdown.',
					}];
				}
				return accounts.map((account: { id: string; username?: string; name?: string }) => ({
					name: account.username ? `@${account.username}` : account.name || account.id,
					value: account.id,
				}));
			},

			async getPinterestBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
				const baseURL = String(credentials.serverUrl || '').replace(/\/$/, '');
				const pinterestUserId = String(this.getNodeParameter('pinterestUserId', 0) || '').trim();
				const uri = pinterestUserId
					? `/api/pinterest/boards?pinterestUserId=${encodeURIComponent(pinterestUserId)}`
					: '/api/pinterest/boards';
				const response = await this.helpers.requestWithAuthentication.call(this, 'postifysApi', {
					method: 'GET',
					baseURL,
					uri,
					json: true,
				});
				const boards = Array.isArray(response.boards) ? response.boards : [];
				if (!boards.length) {
					return [{
						name: 'No Pinterest boards found. Connect Pinterest in Postifys.',
						value: '',
						description: 'Open Postifys, connect Pinterest, then reload this dropdown.',
					}];
				}
				return boards.map((board: { id: string; name?: string }) => ({
					name: board.name || board.id,
					value: board.id,
				}));
			},

			async getLinkedInAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const connections = await getConnections(this);
				const accounts = connections.filter((c) => c.platform === 'linkedin');
				if (!accounts.length) {
					return [{
						name: 'No LinkedIn accounts found. Connect LinkedIn in Postifys.',
						value: '',
						description: 'Open Postifys, connect LinkedIn, then reload this dropdown.',
					}];
				}
				return accounts.map((account: { id: string; name?: string; email?: string }) => ({
					name: account.email ? `${account.name || account.id} (${account.email})` : account.name || account.id,
					value: account.id,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
		const baseURL = String(credentials.serverUrl || '').replace(/\/$/, '');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;

				if (resource === 'media') {
					const operation = this.getNodeParameter('operation', i) as string;
					const host = mediaHostUrl(credentials);

					if (operation === 'uploadFromUrl') {
						const sourceUrl = String(this.getNodeParameter('sourceUrl', i, '') || '').trim();
						const uploadFilename = String(this.getNodeParameter('uploadFilename', i, '') || '').trim();
						if (!sourceUrl) {
							throw new NodeOperationError(this.getNode(), 'Source URL is required.', { itemIndex: i });
						}

						const responseData = await this.helpers.request({
							method: 'POST',
							url: `${host}/api/temp-media/from-url`,
							headers: {
								'Content-Type': 'application/json',
							},
							body: {
								url: sourceUrl,
								...(uploadFilename ? { filename: uploadFilename } : {}),
							},
							json: true,
						}) as Record<string, unknown>;

						returnData.push({
							json: {
								success: true,
								...responseData,
							},
							pairedItem: { item: i },
						});
						continue;
					}

					throw new NodeOperationError(this.getNode(), `Unsupported media operation: ${operation}`, { itemIndex: i });
				}

				const platform = this.getNodeParameter('platform', i) as string;
				let endpoint = '';
				let body: Record<string, unknown> = {};

				if (platform === 'facebook') {
					const pageId = this.getNodeParameter('pageId', i) as string;
					const facebookPostMode = this.getNodeParameter('facebookPostMode', i) as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = normalizeMediaUrls(this.getNodeParameter('mediaUrls', i, '') as string);
					assertDirectMediaUrls(this.getNode(), i, mediaUrls, 'Media URLs');

					assertAccountId(this.getNode(), i, pageId, 'Facebook Page');

					if (!text && !mediaUrls.length) {
						throw new NodeOperationError(this.getNode(), 'Facebook posts require Text or Media URLs.', { itemIndex: i });
					}

					if ((facebookPostMode === 'IMAGE' || facebookPostMode === 'REEL') && !mediaUrls.length) {
						throw new NodeOperationError(this.getNode(), `Media URLs are required for Facebook ${facebookPostMode.toLowerCase()} posts.`, { itemIndex: i });
					}

					endpoint = '/api/facebook/post';
					body = {
						pageId,
						type: mediaUrls.length ? facebookPostMode : 'FEED',
						text,
						mediaUrls,
					};
				} else if (platform === 'instagram') {
					const instagramAccountId = this.getNodeParameter('instagramAccountId', i) as string;
					const mediaType = this.getNodeParameter('mediaType', i) as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = normalizeMediaUrls(this.getNodeParameter('mediaUrls', i, '') as string);
					assertDirectMediaUrls(this.getNode(), i, mediaUrls, 'Media URLs');

					assertAccountId(this.getNode(), i, instagramAccountId, 'Instagram account');

					if (!mediaUrls.length) {
						throw new NodeOperationError(this.getNode(), 'Instagram posts require Media URLs.', { itemIndex: i });
					}

					endpoint = '/api/instagram/post';
					body = {
						instagramAccountId,
						type: mediaType,
						text,
						mediaUrls,
					};
				} else if (platform === 'youtube') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const title = this.getNodeParameter('title', i, '') as string;
					const description = this.getNodeParameter('description', i, '') as string;
					const videoUrl = this.getNodeParameter('videoUrl', i, '') as string;
					const thumbnailUrl = this.getNodeParameter('thumbnailUrl', i, '') as string;
					const privacyStatus = this.getNodeParameter('privacyStatus', i, 'private') as string;
					const tags = this.getNodeParameter('tags', i, '') as string;
					const categoryId = this.getNodeParameter('categoryId', i, '22') as string;
					const notifySubscribers = this.getNodeParameter('notifySubscribers', i, false) as boolean;

					assertAccountId(this.getNode(), i, channelId, 'YouTube Channel');

					if (!String(title || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'YouTube posts require a Title.', { itemIndex: i });
					}

					if (!String(videoUrl || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'YouTube posts require a Video URL.', { itemIndex: i });
					}

					assertDirectMediaUrls(this.getNode(), i, [String(videoUrl).trim()], 'Video URL');
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
					};
				} else if (platform === 'pinterest') {
					const pinterestUserId = this.getNodeParameter('pinterestUserId', i) as string;
					const boardId = this.getNodeParameter('boardId', i) as string;
					const title = this.getNodeParameter('title', i, '') as string;
					const description = this.getNodeParameter('description', i, '') as string;
					const link = this.getNodeParameter('link', i, '') as string;
					const imageUrl = this.getNodeParameter('imageUrl', i, '') as string;
					const mediaUrls = normalizeMediaUrls(this.getNodeParameter('mediaUrls', i, '') as string);
					const resolvedImageUrl = String(imageUrl || mediaUrls[0] || '').trim();
					assertDirectMediaUrls(this.getNode(), i, [resolvedImageUrl], 'Image URL');

					assertAccountId(this.getNode(), i, pinterestUserId, 'Pinterest Account');
					assertAccountId(this.getNode(), i, boardId, 'Pinterest Board');

					if (!String(title || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'Pinterest pins require a Title.', { itemIndex: i });
					}

					if (!resolvedImageUrl) {
						throw new NodeOperationError(this.getNode(), 'Pinterest pins require an Image URL.', { itemIndex: i });
					}

					endpoint = '/api/pinterest/post';
					body = {
						pinterestUserId,
						boardId,
						title,
						description,
						link,
						imageUrl: resolvedImageUrl,
					};
				} else if (platform === 'linkedin') {
					const linkedinUserId = this.getNodeParameter('linkedinUserId', i) as string;
					const linkedinPostType = this.getNodeParameter('linkedinPostType', i, 'image') as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const title = this.getNodeParameter('title', i, '') as string;
					const link = this.getNodeParameter('linkedinLink', i, '') as string;
					const imageUrl = this.getNodeParameter('linkedinImageUrl', i, '') as string;
					const videoUrl = this.getNodeParameter('linkedinVideoUrl', i, '') as string;

					assertAccountId(this.getNode(), i, linkedinUserId, 'LinkedIn Account');

					if (!String(text || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn posts require Text.', { itemIndex: i });
					}

					if (linkedinPostType === 'image' && !String(imageUrl || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn image posts require Image URL.', { itemIndex: i });
					}

					if (linkedinPostType === 'video' && !String(videoUrl || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'LinkedIn video posts require Video URL.', { itemIndex: i });
					}

					if (linkedinPostType === 'image') {
						assertDirectMediaUrls(this.getNode(), i, [String(imageUrl).trim()], 'Image URL');
					}
					if (linkedinPostType === 'video') {
						assertDirectMediaUrls(this.getNode(), i, [String(videoUrl).trim()], 'Video URL');
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
					};
				} else if (platform === 'tiktok') {
					const videoUrl = this.getNodeParameter('videoUrl', i, '') as string;
					const caption = this.getNodeParameter('caption', i, '') as string;

					if (!String(videoUrl || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'TikTok posts require a Video URL.', { itemIndex: i });
					}

					assertDirectMediaUrls(this.getNode(), i, [String(videoUrl).trim()], 'Video URL');

					endpoint = '/api/tiktok/post';
					body = {
						videoUrl,
						caption,
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported platform: ${platform}`, { itemIndex: i });
				}

				const options: IRequestOptions = {
					method: 'POST',
					baseURL,
					uri: endpoint,
					body,
					json: true,
				};

				const responseData = await this.helpers.requestWithAuthentication.call(
					this,
					'postifysApi',
					options,
				);

				returnData.push({
					json: responseData,
					pairedItem: {
						item: i,
					},
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
						pairedItem: {
							item: i,
						},
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
