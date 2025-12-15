# SparkAI Fashion API

A lightweight API service that wraps the Higgsfield AI image generation platform. Designed for VPS deployment and third-party integrations.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
API_KEY=your-secure-api-key
HIGGSFIELD_KEY_ID=your-higgsfield-key-id
HIGGSFIELD_KEY_SECRET=your-higgsfield-key-secret
```

### 3. Run the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

---

## API Endpoints

### Health Check

```
GET /api/health
```

Returns server status. No authentication required.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-15T10:30:00.000Z",
  "service": "sparkai-fashion-api",
  "version": "0.1.0",
  "uptime": 3600
}
```

---

### Generate Image

```
POST /api/generate
```

Submit an image generation request to Higgsfield AI.

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `X-API-Key` | Yes* | Your API key (*if configured) |

**Request Body:**
```json
{
  "prompt": "editorial fashion shot, golden hour lighting",
  "imageUrls": ["https://example.com/reference1.jpg", "https://example.com/reference2.jpg"],
  "resolution": "2k",
  "aspect": "4:3",
  "format": "png",
  "numImages": 1,
  "modelId": "nano-banana-pro/edit"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Text prompt for generation |
| `imageUrls` | string[] | No | Reference image URLs (max 2) |
| `resolution` | string | No | `1k`, `2k`, or `4k` (default: `2k`) |
| `aspect` | string | Yes | Aspect ratio: `4:3`, `4:5`, `5:4` |
| `format` | string | No | Output format: `jpg` or `png` (default: `png`) |
| `numImages` | number | No | Number of images (default: 1) |
| `modelId` | string | No | Higgsfield model ID |

**Response (202 Accepted):**
```json
{
  "requestId": "abc123-def456",
  "status": "queued",
  "message": "Queued. Use /api/status to refresh."
}
```

---

### Check Status

```
GET /api/status?requestId=abc123-def456
```

Check the status of a generation request.

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes* | Your API key (*if configured) |

**Query Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `requestId` | Yes | The request ID from generate |

**Response:**
```json
{
  "requestId": "abc123-def456",
  "status": "succeeded",
  "images": [
    "https://higgsfield.ai/output/image1.png"
  ],
  "payload": { ... }
}
```

**Status Values:**
- `queued` - Request is in queue
- `processing` - Generation in progress
- `succeeded` - Complete, images available
- `failed` - Generation failed
- `cancelled` - Request was cancelled

---

## Example Usage

### cURL

```bash
# Generate image
curl -X POST https://your-vps.com/api/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "prompt": "editorial streetwear, neon city lights",
    "resolution": "2k",
    "aspect": "4:3"
  }'

# Check status
curl "https://your-vps.com/api/status?requestId=abc123" \
  -H "X-API-Key: your-api-key"
```

### JavaScript/Node.js

```javascript
const API_BASE = "https://your-vps.com";
const API_KEY = "your-api-key";

// Generate image
const response = await fetch(`${API_BASE}/api/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  },
  body: JSON.stringify({
    prompt: "editorial streetwear, neon city lights",
    resolution: "2k",
    aspect: "4:3",
  }),
});

const { requestId } = await response.json();

// Poll for status
const statusResponse = await fetch(
  `${API_BASE}/api/status?requestId=${requestId}`,
  { headers: { "X-API-Key": API_KEY } }
);

const { status, images } = await statusResponse.json();
```

### Python

```python
import requests

API_BASE = "https://your-vps.com"
API_KEY = "your-api-key"

# Generate image
response = requests.post(
    f"{API_BASE}/api/generate",
    headers={"X-API-Key": API_KEY},
    json={
        "prompt": "editorial streetwear, neon city lights",
        "resolution": "2k",
        "aspect": "4:3"
    }
)

request_id = response.json()["requestId"]

# Check status
status = requests.get(
    f"{API_BASE}/api/status",
    headers={"X-API-Key": API_KEY},
    params={"requestId": request_id}
)

print(status.json())
```

---

## VPS Deployment

### Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Build the application
npm run build

# Start with PM2
pm2 start npm --name "sparkai-api" -- start

# Save PM2 configuration
pm2 save
pm2 startup
```

### Using Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t sparkai-api .
docker run -d -p 3000:3000 --env-file .env.local sparkai-api
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Security Notes

1. **Always set `API_KEY`** in production to protect your endpoints
2. **Restrict `ALLOWED_ORIGINS`** to your specific domains
3. **Use HTTPS** in production (via Nginx/Cloudflare)
4. **Keep Higgsfield credentials secure** - never commit them to git

---

## License

Private - SparkAI Fashion
