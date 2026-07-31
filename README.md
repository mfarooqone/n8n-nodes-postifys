# n8n-nodes-postifys

Postifys ([postifys.com](https://postifys.com)) is a unified social media publishing API for Facebook, Instagram, YouTube, Pinterest, LinkedIn, and TikTok - via dashboard, REST API, or this n8n community node. It is a publishing API / automation backend, not a consumer content calendar.

**Package:** `n8n-nodes-postifys`  
**Default server:** `https://postifys.com`

### Quick links
- Docs: https://postifys.com/docs  
- API reference: https://postifys.com/api-docs  
- n8n setup: https://postifys.com/n8n  
- Downloadable workflow JSON: https://postifys.com/n8n-workflows  
- Guides: https://postifys.com/guides  
- Compatibility matrix: https://postifys.com/compatibility-matrix  
- Pricing: https://postifys.com/pricing ($2 / connected profile / month)

### Honest limitations
- **TikTok:** creator-inbox upload today; the creator may need to finish publishing in TikTok. Direct Post is not claimed unless separately approved.
- **LinkedIn:** member profiles only (Company Pages not currently offered).
- **Pinterest:** image Pins documented; video Pins not claimed in Postifys today.

Install in n8n → **Settings → Community Nodes** → `n8n-nodes-postifys`.

## Features

- Credential type for your Postifys API key
- Credential test using your Postifys server
- **Media → Upload** - upload any image or video URL to Postifys and return a hosted media URL
- Dynamic dropdowns for connected Facebook Pages, Instagram accounts, YouTube channels, Pinterest accounts/boards, LinkedIn accounts, and TikTok accounts
- Auto field mapping for common input fields such as `url`, `media_url`, `serve_url`, `drive_link`, `title`, and `caption`
- Normalized post output with `status`, `stage`, `isComplete`, `shouldPoll`, `published`, `failed`, and `failureReason`
- Long Instagram videos expose restart-safe carousel item and parent progress while Postifys prepares the ordered carousel post
- `Post -> Get Status` operation for polling a configurable Postifys status endpoint
- Posts default to **async**: the node returns a `postId` immediately and Postifys finishes publishing in the background (same pattern as Instagram Reels). Use Get Status if you need the final result.
- Simple media output with only `name` and `serve_url`
- Publish Facebook Page images
- Publish Facebook Page Reels
- Optional Reel collaborators: Instagram usernames (up to 3) or Facebook Page IDs (up to 10)
- Publish Instagram images
- Publish Instagram videos/Reels
- Upload YouTube videos
- Publish Pinterest image pins
- Publish LinkedIn **member** posts (Company Pages not currently offered)
- Upload TikTok videos to the **creator inbox** (Direct Post only if separately approved)

## Prerequisites

1. Log in to Postifys at https://postifys.com/login
2. Open https://postifys.com/settings and create an API key
3. Connect your Facebook Pages and Instagram professional accounts in Postifys
4. Connect your YouTube channel in Postifys if you want to upload YouTube videos
5. Connect your Pinterest account(s) in Postifys if you want to publish pins
6. Connect your LinkedIn account(s) in Postifys if you want to publish LinkedIn member posts
7. Read the full REST API reference at https://postifys.com/api-docs

## Credentials

Create a new **Postifys API** credential in n8n.

| Field | Value |
|---|---|
| API Key | Your key from Postifys Settings |
| Postifys Server | `https://postifys.com` |

The credential test calls:

```http
GET /api/key/test
Authorization: Bearer YOUR_API_KEY
```

The media upload operation uses **Postifys Server** and calls the Postifys media queue.

## Recommended workflow

Use **two Postifys nodes** in sequence when a platform needs a direct public media URL:

1. **Postifys** - Resource: `Media`, Operation: `Upload`, URL: your image/video URL
   → queues the media on Postifys, waits until it is ready, and outputs `name` and `serve_url`
2. **Postifys** - Resource: `Post`, pick your platform, set Media/Video/Image URL to `={{ $json.serve_url }}`

Do **not** pass raw `drive.google.com`, Dropbox, or `rednote.postifys.com/media/temp/...` links directly to post nodes. Upload them with **Media -> Upload** first, then use the returned Postifys `serve_url` (`https://postifys.com/media/tmp/...`).

For batch workflows, leave **Auto Map Input Fields** enabled:

- Media upload can read common fields such as `url`, `source_url`, `drive_link`, or `path`
- Posting reads `url`, `media_url`, `serve_url`, and other common direct media fields
- Blank captions/titles can fall back to `title` or `caption`
- Rows without media can be skipped instead of failing the whole workflow

### Status Polling

Use **Resource: Post -> Operation: Get Status** after a create step if your Postifys server exposes a status endpoint. The default path is:

```http
GET /api/posts/status?postId=POST_ID&platform=instagram
```

You can change **Status Endpoint Path** to match the deployed Postifys API, for example a future `/api/history/status` route.

## Node Usage

Add the **Postifys** node.

### Facebook

- Resource: `Post`
- Operation: `Create`
- Platform: `Facebook`
- Facebook Page: select a connected Page
- Media Type: `Image` or `Video / Reel`
- Text: post text
- Media URLs: `={{ $json.serve_url }}` from the upload node

The node calls:

```http
POST /api/facebook/post
```

### Instagram

- Resource: `Post`
- Operation: `Create`
- Platform: `Instagram`
- Instagram Account: select a connected Instagram professional account
- Media Type: `Image` or `Video / Reel`
- Text: caption text
- Media URLs: `={{ $json.serve_url }}` from the upload node
- Post Asynchronously: enabled for videos/Reels to avoid long n8n request timeouts

The node calls:

```http
POST /api/instagram/post
```

### YouTube

- Resource: `Post`
- Operation: `Create`
- Platform: `YouTube`
- YouTube Channel: select the connected channel
- Title: video title
- Description: video description
- Video URL: `={{ $json.serve_url }}` from the upload node
- Thumbnail URL: optional public image URL for a custom thumbnail
- Privacy Status: `Private`, `Unlisted`, or `Public`
- Tags: comma-separated list
- Category ID: default `22`
- Notify Subscribers: optional

The node calls:

```http
POST /api/youtube/post
```

### Pinterest

- Resource: `Post`
- Operation: `Create`
- Platform: `Pinterest`
- Pinterest Account: select a connected Pinterest account
- Pinterest Board: select a board for the chosen account
- Pinterest Media Type: `Image Pin` or `Video Pin`
- Title: pin title
- Description: optional pin description
- Link: optional destination URL
- Image URL: `={{ $json.serve_url }}` from the upload node for image pins
- Video URL: `={{ $json.serve_url }}` from the upload node for video pins
- Cover Image URL: optional public cover image URL; if blank, Postifys generates a thumbnail from the video

The node calls:

```http
POST /api/pinterest/post
```

### LinkedIn

- Resource: `Post`
- Operation: `Create`
- Platform: `LinkedIn`
- LinkedIn Account: select a connected LinkedIn member account
- LinkedIn Post Type: `Text`, `Image`, `Video`, or `Link Preview`
- Text: required post text
- Image URL: `={{ $json.serve_url }}` for image posts
- Video URL: `={{ $json.serve_url }}` for video posts
- Title: optional image or link title
- Link: required for link preview posts

The node calls:

```http
POST /api/linkedin/post
```

If you connect multiple Pinterest accounts in Postifys, choose the account first so the board dropdown loads boards for that account.

### TikTok

1. Connect TikTok in Postifys first: open https://postifys.com/app → **Add Account → TikTok** (per-user OAuth).
2. In n8n:
   - Resource: `Post`
   - Operation: `Create`
   - Platform: `TikTok`
   - TikTok Account: select the connected creator from the dropdown
   - TikTok Publishing Method: choose `Direct Post` or `Send as Draft` for each item
   - Caption: optional caption text
   - Video URL: `={{ $json.serve_url }}` from the upload node
   - Direct Post: choose privacy and interaction settings, then enable **I Confirm This Direct Post**
   - Send as Draft: Postifys uploads the video to the TikTok inbox; the creator finishes editing and publishing in TikTok

The node calls:

```http
POST /api/tiktok/post
```

with `tiktokAccountId` (TikTok `open_id` from `/api/connections`) and
`postMode` (`direct` or `inbox`). Direct Post also sends `consent: true`.

Success statuses:
- `PUBLISH_COMPLETE` - direct feed publish (`video.publish`)
- `SEND_TO_USER_INBOX` - draft delivered to creator inbox (`video.upload`)

## Output Shape

Post operations return normalized fields:

```json
{
  "success": true,
  "platform": "instagram",
  "operation": "create",
  "postId": "POST_OR_HISTORY_ID",
  "status": "processing",
  "stage": "processing_carousel_item",
  "isComplete": false,
  "shouldPoll": true,
  "published": false,
  "failed": false,
  "failureReason": "",
	"mode": "carousel",
	"itemsTotal": 9,
	"itemsReady": 3,
	"itemsFailed": 0,
	"currentItem": 4,
	"carouselsTotal": 1,
	"carouselsPublished": 0,
	"items": [],
	"carousels": [],
  "url": "",
  "historyId": "POSTIFYS_HISTORY_ID",
  "raw": {}
}
```

Continue polling while `shouldPoll` is `true`. Stop when `isComplete` becomes `true`; then check `published`, `failed`, and `failureReason`. Long Instagram videos include `mode: "carousel"`, item counters, and parent-carousel counters. Finished child containers are preparation state, not separate published posts. Use `raw` when you need the full Postifys response.

## Install in n8n

In n8n, go to **Settings → Community Nodes**, then install:

```text
n8n-nodes-postifys
```

## Development

```bash
npm install
npm run build
npm test
npm run release:check
```

## License

MIT
