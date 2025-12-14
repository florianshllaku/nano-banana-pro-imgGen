import type { NextApiRequest, NextApiResponse } from "next";

type HiggsfieldSubmitResponse = {
  request_id?: string;
  requestId?: string;
  status?: string;
  image_urls?: string[];
  outputs?: string[];
  error?: string;
  [key: string]: unknown;
};

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 15000,
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export const config = {
  api: {
    bodyParser: {
      // Raise limit to handle base64 image data URLs from the client
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    prompt,
    imageUrls = [],
    resolution = "2k",
    aspect,
    format = "png",
    numImages = 1,
    modelId,
  } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!["1k", "2k", "4k"].includes(String(resolution).toLowerCase())) {
    return res.status(400).json({ error: "Resolution must be 1k, 2k, or 4k" });
  }

  if (!aspect || typeof aspect !== "string") {
    return res.status(400).json({ error: "Aspect ratio is required" });
  }

  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  const bearer = process.env.HIGGSFIELD_BEARER_TOKEN;
  const model =
    modelId || process.env.HIGGSFIELD_MODEL_ID || "nano-banana-pro/edit";

  if (!keyId && !keySecret && !bearer) {
    return res.status(500).json({
      error: "Server missing Higgsfield credentials",
      hint: "Add HIGGSFIELD_KEY_ID/HIGGSFIELD_KEY_SECRET or HIGGSFIELD_BEARER_TOKEN to .env.local",
    });
  }

  const authHeaders: Record<string, string> = {};

  if (bearer) {
    authHeaders.Authorization = `Bearer ${bearer}`;
  } else if (keyId && keySecret) {
    // Per Higgsfield docs: Authorization: Key {id}:{secret}
    authHeaders.Authorization = `Key ${keyId}:${keySecret}`;
  }

  if (process.env.HIGGSFIELD_API_KEY) {
    authHeaders["x-api-key"] = process.env.HIGGSFIELD_API_KEY;
  }

  try {
    const totalImageChars = Array.isArray(imageUrls)
      ? imageUrls.reduce((acc, v) => acc + String(v).length, 0)
      : 0;

    console.log("[generate] submit ->", {
      model,
      promptLength: prompt.length,
      images: imageUrls?.length ?? 0,
      totalImageChars,
      resolution,
      aspect,
      format,
      authMode: bearer ? "bearer" : keyId && keySecret ? "key" : "unknown",
    });

    // Higgsfield expects actual URLs, not base64 data URLs.
    // Filter out data URLs and only send real http(s) URLs.
    const validImageUrls = Array.isArray(imageUrls)
      ? imageUrls.filter(
          (url: string) =>
            typeof url === "string" &&
            (url.startsWith("http://") || url.startsWith("https://")),
        )
      : [];

    const skippedDataUrls = (imageUrls?.length ?? 0) - validImageUrls.length;
    if (skippedDataUrls > 0) {
      console.log(
        `[generate] Skipped ${skippedDataUrls} data URL(s) — Higgsfield requires hosted image URLs`,
      );
    }

    const requestBody: Record<string, unknown> = {
      prompt,
      num_images: numImages,
      resolution: String(resolution).toLowerCase(),
      aspect_ratio: aspect,
      output_format: format,
    };

    // Only include image_urls if we have valid ones
    if (validImageUrls.length > 0) {
      requestBody.image_urls = validImageUrls;
    }

    const submitRes = await fetchWithTimeout(
      `${HIGGSFIELD_BASE}/${model}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(requestBody),
      },
      15000,
    );

    // Handle non-JSON responses (Higgsfield sometimes returns plain text errors)
    const contentType = submitRes.headers.get("content-type") || "";
    let submitJson: HiggsfieldSubmitResponse | null = null;
    let rawText = "";

    if (contentType.includes("application/json")) {
      submitJson = (await submitRes.json().catch(() => null)) as HiggsfieldSubmitResponse | null;
    } else {
      rawText = await submitRes.text().catch(() => "");
      console.log("[generate] Non-JSON response from Higgsfield:", rawText);
    }

    if (!submitRes.ok) {
      return res.status(submitRes.status).json({
        error:
          submitJson?.error ||
          submitJson?.message ||
          submitJson?.detail ||
          rawText ||
          "Failed to queue generation",
        status: submitRes.status,
        detail: submitJson,
        rawText: rawText || undefined,
        requestId: submitJson?.request_id || submitJson?.requestId,
        note: skippedDataUrls > 0
          ? `Skipped ${skippedDataUrls} local image(s). Higgsfield requires hosted image URLs (http/https), not base64 data.`
          : undefined,
      });
    }

    const requestId = submitJson?.request_id || submitJson?.requestId;
    if (!requestId) {
      return res.status(502).json({
        error: "Missing request_id in Higgsfield response",
        detail: submitJson,
      });
    }

    // Poll for completion
    // Return early with the requestId; client can poll /api/status
    return res.status(202).json({
      requestId,
      status: "queued",
      message: "Queued. Use /api/status to refresh.",
      queued: submitJson,
      polled: false,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";
    return res.status(500).json({ error: message });
  }
}

