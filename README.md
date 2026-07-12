# n8n-nodes-postifys

Publish Facebook, Instagram, YouTube, Pinterest, LinkedIn, and TikTok posts from n8n through [Postifys](https://postifys.com).

**API documentation:** https://postifys.com/api-docs

## Features

- Credential type for your Postifys API key
- Credential test using your Postifys server
- **Media → Upload from URL** — re-host Google Drive links as direct `video/mp4` URLs (auto-deletes after 15 minutes)
- Dynamic dropdowns for connected Facebook Pages and Instagram accounts
- Publish Facebook Page images
- Publish Facebook Page Reels
- Publish Instagram images
- Publish Instagram videos/Reels
- Upload YouTube videos
- Publish Pinterest image pins
- Publish LinkedIn member posts
- Publish TikTok videos

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
| Media Host URL | `https://rednote.postifys.com` (for Upload from URL) |

The credential test calls:

```http
GET /api/key/test
Authorization: Bearer YOUR_API_KEY
```

## Recommended workflow

Use **two Postifys nodes** in sequence for any platform that needs media from Google Drive or Dropbox:

1. **Postifys** — Resource: `Media`, Operation: `Upload from URL`, Source URL: your Drive link  
   → outputs `serve_url` (auto-deletes from the host after 15 minutes)
2. **Postifys** — Resource: `Post`, pick your platform, set Media/Video/Image URL to `={{ $json.serve_url }}`

Do **not** pass raw `drive.google.com` or Dropbox links to post nodes — the node will reject them and ask you to upload first.

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
- Title: pin title
- Description: optional pin description
- Link: optional destination URL
- Image URL: `={{ $json.serve_url }}` from the upload node

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

## Install in n8n

In n8n, go to **Settings → Community Nodes**, then install:

```text
n8n-nodes-postifys
```

## Development

```bash
npm install
npm run build
```

## License

MIT
