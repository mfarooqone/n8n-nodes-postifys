# n8n-nodes-postifys

Publish Facebook and Instagram posts from n8n through [Postifys](https://postifys.com).

## Features

- Credential type for your Postifys API key
- Credential test using your Postifys server
- Dynamic dropdowns for connected Facebook Pages and Instagram accounts
- Publish Facebook Page posts
- Publish Instagram images
- Publish Instagram videos/Reels

## Prerequisites

1. Log in to Postifys.
2. Open `https://postifys.com/settings`.
3. Create an API key.
4. Connect your Facebook Pages and Instagram professional accounts in Postifys.

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
- Text: post text
- Media URLs: optional URL list, one per line or comma-separated

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
