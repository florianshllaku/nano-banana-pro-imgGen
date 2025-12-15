import type { NextApiRequest, NextApiResponse } from "next";
import { withMiddleware } from "../../lib/middleware";

type HiggsfieldStatusResponse = {
  request_id?: string;
  requestId?: string;
  status?: string;
  state?: string;
  image_urls?: string[];
  outputs?: string[];
  result?: string[];
  error?: string;
  message?: string;
  detail?: unknown;
  [key: string]: unknown;
};

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";

function buildAuthHeaders() {
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  const bearer = process.env.HIGGSFIELD_BEARER_TOKEN;
  const headers: Record<string, string> = {};

  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  } else if (keyId && keySecret) {
    headers.Authorization = `Key ${keyId}:${keySecret}`;
  }

  if (process.env.HIGGSFIELD_API_KEY) {
    headers["x-api-key"] = process.env.HIGGSFIELD_API_KEY;
  }

  return headers;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestId = (req.query.requestId || req.query.request_id) as string;
  if (!requestId) {
    return res.status(400).json({ error: "requestId is required" });
  }

  const headers = buildAuthHeaders();
  if (Object.keys(headers).length === 0) {
    return res.status(500).json({
      error: "Server missing Higgsfield credentials",
      hint: "Add HIGGSFIELD_KEY_ID/HIGGSFIELD_KEY_SECRET or HIGGSFIELD_BEARER_TOKEN to .env.local",
    });
  }

  try {
    const statusRes = await fetch(
      `${HIGGSFIELD_BASE}/requests/${requestId}/status`,
      { headers: { Accept: "application/json", ...headers } },
    );
    const payload = (await statusRes.json().catch(() => null)) as
      | HiggsfieldStatusResponse
      | null;

    if (!statusRes.ok) {
      return res.status(statusRes.status).json({
        error:
          payload?.error ||
          payload?.message ||
          payload?.detail ||
          "Failed to fetch request status",
        detail: payload,
      });
    }

    const state = payload?.status || payload?.state;
    
    // Extract images - handle multiple formats:
    // Format 1: payload.images = [{ url: "..." }, { url: "..." }]
    // Format 2: payload.image_urls = ["...", "..."]
    let images: string[] = [];
    
    if (payload?.images && Array.isArray(payload.images)) {
      images = (payload.images as Array<{ url?: string } | string>).map((img) => 
        typeof img === "object" && img.url ? img.url : (typeof img === "string" ? img : "")
      ).filter(Boolean);
    } else if (payload?.image_urls) {
      images = Array.isArray(payload.image_urls) ? payload.image_urls : [];
    } else if (payload?.outputs) {
      images = Array.isArray(payload.outputs) ? payload.outputs : [];
    } else if (payload?.result) {
      images = Array.isArray(payload.result) ? payload.result : [];
    }

    return res.status(200).json({
      requestId,
      status: state,
      images,
      payload,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";
    return res.status(500).json({ error: message });
  }
}

export default withMiddleware(handler);

