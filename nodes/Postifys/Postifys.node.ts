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
};

const normalizeMediaUrls = (value: string) => String(value || '')
	.split(/\r?\n|,/)
	.map((item) => item.trim())
	.filter(Boolean);

const shouldAutoProxyDownload = (mediaUrls: string, platform: string, mediaType?: string) => {
	const lowered = String(mediaUrls || '').toLowerCase();
	if (/(drive\.google\.com|dropbox\.com|dropboxusercontent\.com)/.test(lowered)) {
		return true;
	}

	return ['facebook', 'instagram'].includes(platform) && (mediaType === 'REEL' || mediaType === 'VIDEO');
};

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

export class Postifys implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postifys',
		name: 'postifys',
		icon: 'file:postifys.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["platform"]}}',
		description: 'Publish Facebook, Instagram, and TikTok posts through Postifys',
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
						name: 'Post',
						value: 'post',
					},
				],
				default: 'post',
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
						platform: ['facebook', 'instagram'],
					},
				},
				default: '',
				description: 'Post text or Instagram caption. For Facebook, Text or Media URLs is required.',
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
				placeholder: 'https://example.com/image.jpg',
				description: 'Public media URLs. Enter one per line or comma-separated. Postifys publishes the first URL.',
			},
			{
				displayName: 'Video URL',
				name: 'videoUrl',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['tiktok'],
					},
				},
				default: '',
				placeholder: 'https://example.com/video.mp4',
				description: 'Public TikTok video URL.',
			},
			{
				displayName: 'Proxy Download',
				name: 'proxyDownload',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['create'],
						platform: ['facebook', 'instagram'],
					},
				},
				description: 'Let Postifys download the media to a temporary file, publish it, then delete the temp file. Automatically enabled for Google Drive and Dropbox URLs.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getFacebookPages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
				const baseURL = String(credentials.serverUrl || '').replace(/\/$/, '');
				const response = await this.helpers.requestWithAuthentication.call(this, 'postifysApi', {
					method: 'GET',
					baseURL,
					uri: '/api/meta/pages',
					json: true,
				});
				const pages = Array.isArray(response.pages) ? response.pages : [];
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
				const credentials = await this.getCredentials('postifysApi') as PostifysCredentials;
				const baseURL = String(credentials.serverUrl || '').replace(/\/$/, '');
				const response = await this.helpers.requestWithAuthentication.call(this, 'postifysApi', {
					method: 'GET',
					baseURL,
					uri: '/api/meta/instagram-accounts',
					json: true,
				});
				const accounts = Array.isArray(response.instagramAccounts) ? response.instagramAccounts : [];
				if (!accounts.length) {
					return [{
						name: 'No Instagram accounts found. Reconnect Meta in Postifys.',
						value: '',
						description: 'Open Postifys, connect Instagram/Facebook again, then reload this dropdown.',
					}];
				}
				return accounts.map((account: { id: string; username?: string; name?: string }) => ({
					name: account.username ? `@${account.username}` : account.name || account.id,
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
				const platform = this.getNodeParameter('platform', i) as string;
				let endpoint = '';
				let body: Record<string, unknown> = {};

				if (platform === 'facebook') {
					const pageId = this.getNodeParameter('pageId', i) as string;
					const facebookPostMode = this.getNodeParameter('facebookPostMode', i) as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = normalizeMediaUrls(this.getNodeParameter('mediaUrls', i, '') as string);
					const proxyDownload = Boolean(this.getNodeParameter('proxyDownload', i, false))
						|| shouldAutoProxyDownload(mediaUrls.join('\n'), platform, facebookPostMode);

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
						proxyDownload,
					};
				} else if (platform === 'instagram') {
					const instagramAccountId = this.getNodeParameter('instagramAccountId', i) as string;
					const mediaType = this.getNodeParameter('mediaType', i) as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = normalizeMediaUrls(this.getNodeParameter('mediaUrls', i, '') as string);
					const proxyDownload = Boolean(this.getNodeParameter('proxyDownload', i, false))
						|| shouldAutoProxyDownload(mediaUrls.join('\n'), platform, mediaType);

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
						proxyDownload,
					};
				} else if (platform === 'tiktok') {
					const videoUrl = this.getNodeParameter('videoUrl', i, '') as string;
					const caption = this.getNodeParameter('caption', i, '') as string;

					if (!String(videoUrl || '').trim()) {
						throw new NodeOperationError(this.getNode(), 'TikTok posts require a Video URL.', { itemIndex: i });
					}

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
