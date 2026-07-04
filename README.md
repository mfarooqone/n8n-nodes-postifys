# n8n-nodes-postifys

Publish Facebook, Instagram, YouTube, Pinterest, LinkedIn, and TikTok posts from n8n through [Postifys](https://postifys.com).

**API documentation:** https://postifys.com/api-docs

## Features

- Credential type for your Postifys API key
- Credential test using your Postifys server
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

The credential test calls:

```http
GET /api/key/test
Authorization: Bearer YOUR_API_KEY
```

## Node Usage

Add the **Postifys** node.

### Facebook

- Resource: `Post`
- Operation: `Create`
- Platform: `Facebook`
- Facebook Page: select a connected Page
- Media Type: `Image` or `Video / Reel`
- Text: post text
- Media URLs: optional URL list, one per line or comma-separated

Facebook media publishes natively:

- `Image` uses the Facebook Page photos API
- `Video / Reel` uses the Facebook Reels API
- Text-only Facebook posts are sent as feed posts

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
- Media URLs: public media URL list, one per line or comma-separated

The node calls:

```http
POST /api/instagram/post
```

### Google Drive and proxy download

For Google Drive, Dropbox, or other links that Meta cannot fetch directly, enable **Proxy Download** or use a Google Drive URL directly. Postifys will:

1. Download the file to a temporary location on the server
2. Publish the Reel or image to Facebook or Instagram
3. Delete the temporary file

Google Drive links such as `https://drive.google.com/uc?export=download&id=FILE_ID` automatically enable proxy mode. The file must be shared as **Anyone with the link**.

### YouTube

- Resource: `Post`
- Operation: `Create`
- Platform: `YouTube`
- YouTube Channel: select the connected channel
- Title: video title
- Description: video description
- Video URL: public downloadable video URL
- Thumbnail URL: optional public image URL for a custom thumbnail
- Privacy Status: `Private`, `Unlisted`, or `Public`
- Tags: comma-separated list
- Category ID: default `22`
- Notify Subscribers: optional

The node calls:

```http
POST /api/youtube/post
```

Postifys downloads the video to temporary storage, uploads it to the connected YouTube channel, records publish history, then deletes the temp file.

### Pinterest

- Resource: `Post`
- Operation: `Create`
- Platform: `Pinterest`
- Pinterest Account: select a connected Pinterest account
- Pinterest Board: select a board for the chosen account
- Title: pin title
- Description: optional pin description
- Link: optional destination URL
- Image URL: public image URL for the pin
- Proxy Download: optional; auto-enabled for Google Drive and Dropbox links

The node calls:

```http
POST /api/pinterest/post
```

### LinkedIn

- Resource: `Post`
- Operation: `Create`
- Platform: `LinkedIn`
- LinkedIn Account: select a connected LinkedIn member account
- Text: required post text
- Title: optional link title
- Link: optional URL for a LinkedIn link preview

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
