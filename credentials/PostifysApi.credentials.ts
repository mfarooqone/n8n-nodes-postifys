import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PostifysApi implements ICredentialType {
	name = 'postifysApi';

	displayName = 'Postifys API';

	documentationUrl = 'https://postifys.com/api-docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
		{
			displayName: 'Postifys Server',
			name: 'serverUrl',
			type: 'string',
			default: 'https://postifys.com',
			required: true,
			description: 'Base URL of your Postifys server.',
		},
	];

	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.serverUrl.replace(/\\/$/, "")}}',
			url: '/api/key/test',
			method: 'GET',
		},
	};
}
