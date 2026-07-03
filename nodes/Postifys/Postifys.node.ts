import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IRequestOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type PostifysCredentials = {
	serverUrl: string;
	apiKey: string;
};

export class Postifys implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postifys',
		name: 'postifys',
		icon: 'file:postifys.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["platform"]}}',
		description: 'Publish Facebook and Instagram posts through Postifys',
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
				description: 'Public media URLs. Enter one per line or comma-separated. Instagram requires at least one URL; Postifys currently publishes the first URL.',
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
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = this.getNodeParameter('mediaUrls', i, '') as string;

					if (!text && !mediaUrls) {
						throw new NodeOperationError(this.getNode(), 'Facebook posts require Text or Media URLs.', { itemIndex: i });
					}

					endpoint = '/api/facebook/post';
					body = {
						pageId,
						text,
						mediaUrls,
					};
				} else if (platform === 'instagram') {
					const instagramAccountId = this.getNodeParameter('instagramAccountId', i) as string;
					const mediaType = this.getNodeParameter('mediaType', i) as string;
					const text = this.getNodeParameter('text', i, '') as string;
					const mediaUrls = this.getNodeParameter('mediaUrls', i) as string;

					if (!mediaUrls) {
						throw new NodeOperationError(this.getNode(), 'Instagram posts require Media URLs.', { itemIndex: i });
					}

					endpoint = '/api/instagram/post';
					body = {
						instagramAccountId,
						type: mediaType,
						text,
						mediaUrls,
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
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: {
							item: i,
						},
					});
					continue;
				}

				throw error;
			}
		}

		return [returnData];
	}
}
