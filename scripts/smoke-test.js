const assert = require('node:assert/strict');

const {
	Postifys,
	__postifysTestUtils,
	normalizePostifysResult,
} = require('../dist/nodes/Postifys/Postifys.node.js');

const node = new Postifys();
const properties = node.description.properties;

const property = (name) => properties.find((item) => item.name === name);
const operation = properties.find((item) => item.name === 'operation' && item.displayOptions?.show?.resource?.includes('post'));
const mediaOperation = properties.find((item) => item.name === 'operation' && item.displayOptions?.show?.resource?.includes('media'));
const operationValues = operation.options.map((item) => item.value);
const mediaOperationValues = mediaOperation.options.map((item) => item.value);

assert.equal(node.description.name, 'postifys');
assert.ok(operationValues.includes('create'), 'post create operation is registered');
assert.ok(operationValues.includes('getStatus'), 'post status operation is registered');
assert.ok(mediaOperationValues.includes('uploadFromUrl'), 'media upload operation is registered');
assert.ok(mediaOperationValues.includes('ensureMediaUrl'), 'legacy ensure media operation is registered');
assert.equal(mediaOperation.default, 'uploadFromUrl');
assert.equal(property('tiktokAccountId').typeOptions.loadOptionsMethod, 'getTikTokAccounts');
assert.equal(property('tiktokPostMode').default, 'direct');
assert.deepEqual(property('tiktokPostMode').options.map((item) => item.value), ['direct', 'inbox']);
assert.equal(property('tiktokDirectPostConsent').default, false);
assert.equal(property('rednoteBatchMode').default, true);
assert.equal(property('rednoteBatchMode').displayName, 'Auto Map Input Fields');
assert.equal(property('rednotePostBatchMode').default, true);
assert.equal(property('rednotePostBatchMode').displayName, 'Auto Map Input Fields');
assert.equal(property('asyncPublish').default, true);
assert.equal(property('statusPath').default, '/api/posts/status');
assert.equal(typeof node.methods.loadOptions.getTikTokAccounts, 'function');

assert.deepEqual(
	__postifysTestUtils.normalizeMediaUrls('https://a.test/1.mp4, https://a.test/2.mp4\nhttps://a.test/3.mp4'),
	['https://a.test/1.mp4', 'https://a.test/2.mp4', 'https://a.test/3.mp4'],
);

assert.deepEqual(
	__postifysTestUtils.normalizeUploadedMediaResult({
		success: true,
		filename: 'video.mp4',
		serve_url: 'https://media.test/video.mp4',
		cache_hit: true,
	}),
	{
		name: 'video.mp4',
		serve_url: 'https://media.test/video.mp4',
	},
);

assert.equal(
	__postifysTestUtils.isRednoteTempMediaUrl('https://rednote.postifys.com/media/temp/token/file.mp4'),
	true,
);
assert.equal(
	__postifysTestUtils.isRednoteTempMediaUrl('https://postifys.com/media/tmp/token/file.mp4'),
	false,
);

assert.deepEqual(
	normalizePostifysResult('instagram', 'create', {
		success: true,
		accepted: true,
		postSubmissionId: 'post_async_123',
		status: 'queued',
	}),
	{
		success: true,
		platform: 'instagram',
		operation: 'create',
		postId: 'post_async_123',
		status: 'queued',
		stage: '',
		accepted: true,
		isComplete: false,
		shouldPoll: true,
		published: false,
		failed: false,
		failureReason: '',
		url: '',
		historyId: 'post_async_123',
		raw: {
			success: true,
			accepted: true,
			postSubmissionId: 'post_async_123',
			status: 'queued',
		},
	},
);

assert.deepEqual(
	normalizePostifysResult('tiktok', 'create', {
		success: true,
		data: {
			publish_id: 'v_pub_url~123',
			status: 'PROCESSING',
		},
	}),
	{
		success: true,
		platform: 'tiktok',
		operation: 'create',
		postId: 'v_pub_url~123',
		status: 'PROCESSING',
		stage: '',
		accepted: false,
		isComplete: false,
		shouldPoll: true,
		published: false,
		failed: false,
		failureReason: '',
		url: '',
		historyId: '',
		raw: {
			success: true,
			data: {
				publish_id: 'v_pub_url~123',
				status: 'PROCESSING',
			},
		},
	},
);

const tiktokInbox = normalizePostifysResult('tiktok', 'create', {
	success: true,
	historyId: 'hist_tt_1',
	data: {
		publish_id: 'v_inbox_file~456',
		status: 'SEND_TO_USER_INBOX',
		post_mode: 'inbox',
	},
});
assert.equal(tiktokInbox.isComplete, true);
assert.equal(tiktokInbox.shouldPoll, false);
assert.equal(tiktokInbox.published, true);
assert.equal(tiktokInbox.postId, 'hist_tt_1');
assert.equal(tiktokInbox.postMode, 'inbox');
assert.equal(tiktokInbox.historyId, 'hist_tt_1');
assert.equal(tiktokInbox.raw.data.publish_id, 'v_inbox_file~456');

const tiktokDirect = normalizePostifysResult('tiktok', 'create', {
	success: true,
	data: {
		publish_id: 'v_pub_url~789',
		status: 'PUBLISH_COMPLETE',
		post_mode: 'direct',
	},
});
assert.equal(tiktokDirect.isComplete, true);
assert.equal(tiktokDirect.published, true);
assert.equal(tiktokDirect.postMode, 'direct');

assert.deepEqual(
	normalizePostifysResult('instagram', 'getStatus', {
		success: true,
		postId: 'post_processing_123',
		status: 'processing',
		stage: 'converting',
		failureReason: '',
	}),
	{
		success: true,
		platform: 'instagram',
		operation: 'getStatus',
		postId: 'post_processing_123',
		status: 'processing',
		stage: 'converting',
		accepted: false,
		isComplete: false,
		shouldPoll: true,
		published: false,
		failed: false,
		failureReason: '',
		url: '',
		historyId: 'post_processing_123',
		raw: {
			success: true,
			postId: 'post_processing_123',
			status: 'processing',
			stage: 'converting',
			failureReason: '',
		},
	},
);

const failedStatus = normalizePostifysResult('instagram', 'getStatus', {
	success: true,
	postId: 'post_failed_123',
	status: 'failed',
	stage: 'uploading_to_instagram',
	failureReason: 'Meta rejected the processed video.',
});
assert.equal(failedStatus.isComplete, true);
assert.equal(failedStatus.shouldPoll, false);
assert.equal(failedStatus.failed, true);
assert.equal(failedStatus.failureReason, 'Meta rejected the processed video.');

const splitStatus = normalizePostifysResult('instagram', 'getStatus', {
	success: true,
	postId: 'post_split_123',
	status: 'processing',
	stage: 'uploading_part_to_instagram',
	partsTotal: 3,
	partsPublished: 1,
	partsFailed: 0,
	currentPart: 2,
	parts: [
		{ part: 1, total: 3, status: 'published', postId: 'ig_part_1' },
		{ part: 2, total: 3, status: 'processing', postId: '' },
		{ part: 3, total: 3, status: 'queued', postId: '' },
	],
});
assert.equal(splitStatus.partsTotal, 3);
assert.equal(splitStatus.partsPublished, 1);
assert.equal(splitStatus.partsFailed, 0);
assert.equal(splitStatus.currentPart, 2);
assert.equal(splitStatus.parts[0].postId, 'ig_part_1');

const carouselStatus = normalizePostifysResult('instagram', 'getStatus', {
	success: true,
	postId: 'post_carousel_123',
	status: 'processing',
	stage: 'processing_carousel_item',
	mode: 'carousel',
	itemsTotal: 9,
	itemsReady: 3,
	itemsFailed: 0,
	currentItem: 4,
	carouselsTotal: 1,
	carouselsReady: 0,
	carouselsPublished: 0,
	items: [
		{ index: 1, total: 9, status: 'finished', childContainerId: 'child_1' },
		{ index: 2, total: 9, status: 'finished', childContainerId: 'child_2' },
		{ index: 3, total: 9, status: 'finished', childContainerId: 'child_3' },
	],
	carousels: [{ index: 1, total: 1, status: 'planned', parentContainerId: '' }],
	partsReady: 3,
	partsTotal: 9,
	partsPublished: 0,
	parts: [],
});
assert.equal(carouselStatus.mode, 'carousel');
assert.equal(carouselStatus.itemsTotal, 9);
assert.equal(carouselStatus.itemsReady, 3);
assert.equal(carouselStatus.currentItem, 4);
assert.equal(carouselStatus.carouselsTotal, 1);
assert.equal(carouselStatus.partsPublished, 0);
assert.equal(carouselStatus.shouldPoll, true);

const collaboratorStatus = normalizePostifysResult('facebook', 'getStatus', {
	success: true,
	postId: 'post_collab_123',
	status: 'published',
	collaborators: ['111', '222'],
	collaboratorInvites: [
		{ targetId: '111', status: 'invited' },
		{ targetId: '222', status: 'failed', error: 'denied' },
	],
});
assert.deepEqual(collaboratorStatus.collaborators, ['111', '222']);
assert.equal(collaboratorStatus.collaboratorInvites[0].status, 'invited');
assert.equal(collaboratorStatus.collaboratorInvites[1].status, 'failed');
assert.equal(collaboratorStatus.published, true);

console.log('Postifys node smoke tests passed.');
