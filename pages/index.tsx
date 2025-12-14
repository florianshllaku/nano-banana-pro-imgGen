import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Resolution = "1K" | "2K" | "4K";
type Format = "jpg" | "png";
type AspectRatio = "4:3" | "4:5" | "5:4";

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "error"];
const POLL_INTERVAL_MS = 20000; // Poll every 20 seconds

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<Resolution>("2K");
  const [format, setFormat] = useState<Format>("jpg");
  const [aspect, setAspect] = useState<AspectRatio>("4:3");
  const [files, setFiles] = useState<Array<File | null>>([null, null]);
  const [imageUrls, setImageUrls] = useState<[string, string]>(["", ""]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [serverDetail, setServerDetail] = useState<unknown>(null);
  const [queueDetail, setQueueDetail] = useState<unknown>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [lastCall, setLastCall] = useState<{
    endpoint: string;
    status: number | null;
    body: unknown;
  } | null>(null);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const runStatusRefresh = useCallback(async (id: string, isAutomatic = false) => {
    if (!isAutomatic) {
      setIsLoading(true);
    }
    setError(null);
    setMessage(isAutomatic ? `Auto-polling... (check #${pollCount + 1})` : "Refreshing status...");
    try {
      const response = await fetch(`/api/status?requestId=${id}`);
      const data = await response.json();
      setLastCall({ endpoint: "/api/status", status: response.status, body: data });
      if (!response.ok) {
        const detail =
          typeof data?.detail === "object"
            ? JSON.stringify(data.detail)
            : data?.detail;
        throw new Error(
          data?.error ||
            detail ||
            `Status check failed (status ${response.status})`,
        );
      }
      setResultImages(Array.isArray(data.images) ? data.images : []);
      setServerDetail(data.payload ?? null);
      const status = data.status || (data.payload as Record<string, unknown>)?.status || null;
      setCurrentStatus(status);
      setMessage(
        status
          ? `Status: ${status}`
          : "Status refreshed — no status field returned",
      );
      setPollCount((c) => c + 1);

      // Stop polling if we reached a terminal status
      if (status && TERMINAL_STATUSES.includes(status)) {
        stopPolling();
        if (status === "succeeded") {
          setMessage("✓ Generation complete!");
        } else if (status === "failed" || status === "error") {
          setError(`Generation ${status}`);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected error during status",
      );
      setMessage(null);
      stopPolling(); // Stop on error
    } finally {
      if (!isAutomatic) {
        setIsLoading(false);
      }
    }
  }, [pollCount, stopPolling]);

  // Start polling
  const startPolling = useCallback((id: string) => {
    stopPolling(); // Clear any existing interval
    setPollCount(0);
    setIsPolling(true);
    
    // Initial check
    void runStatusRefresh(id, true);
    
    // Set up interval
    pollIntervalRef.current = setInterval(() => {
      void runStatusRefresh(id, true);
    }, POLL_INTERVAL_MS);
  }, [runStatusRefresh, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const previews = useMemo(
    () =>
      files
        .map((file) =>
          file
            ? {
                name: file.name,
                url: URL.createObjectURL(file),
              }
            : null,
        )
        .filter(Boolean) as { name: string; url: string }[],
    [files],
  );

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: 0 | 1,
  ) => {
    const file = e.target.files?.[0] ?? null;
    const next = [...files] as Array<File | null>;
    next[slot] = file;
    setFiles(next);
    setMessage(
      next.filter(Boolean).length > 0
        ? `Attached ${next.filter(Boolean).length} file${
            next.filter(Boolean).length > 1 ? "s" : ""
          }`
        : null,
    );
  };

  const clearFile = (slot: 0 | 1) => {
    const next = [...files] as Array<File | null>;
    next[slot] = null;
    setFiles(next);
    setMessage(
      next.filter(Boolean).length > 0
        ? `Attached ${next.filter(Boolean).length} file${
            next.filter(Boolean).length > 1 ? "s" : ""
          }`
        : null,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage("Sending to backend...");
    setIsLoading(true);
    setResultImages([]);

    try {
      // Use pasted URLs (filter out empty strings)
      const validUrls = imageUrls.filter(
        (url) => url.trim() && (url.startsWith("http://") || url.startsWith("https://"))
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          imageUrls: validUrls,
          resolution: resolution.toLowerCase(),
          aspect,
          format,
          numImages: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      setLastCall({ endpoint: "/api/generate", status: response.status, body: data });
      if (!response.ok) {
        const detail =
          typeof data?.detail === "object"
            ? JSON.stringify(data.detail)
            : data?.detail;
        throw new Error(
          data?.error ||
            detail ||
            `Generation failed (status ${response.status})`,
        );
      }

      setResultImages(Array.isArray(data.images) ? data.images : []);
      const reqId = data.requestId ?? null;
      setRequestId(reqId);
      setServerDetail(data.payload ?? data.detail ?? null);
      setQueueDetail(data.queued ?? null);
      setMessage(
        data.message ||
          (data.status === "pending"
            ? "Queued... still processing"
            : "Generation submitted"),
      );

      // If we got a requestId, start auto-polling
      if (reqId) {
        startPolling(reqId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out. Try again or use Refresh status with the request ID.");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unexpected error during request",
        );
      }
      setMessage(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshStatus = async () => {
    if (!requestId) return;
    stopPolling();
    await runStatusRefresh(requestId, false);
  };

  const togglePolling = () => {
    if (!requestId) return;
    if (isPolling) {
      stopPolling();
      setMessage("Polling stopped");
    } else {
      startPolling(requestId);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-slate-400">
              sparkai fashion
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Vision Prompt Studio
            </h1>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/90">
            Frontend mock — backend hookup next
          </div>
        </header>

        <main className="mt-10 grid gap-6 lg:grid-cols-[2fr,1fr]">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Create a render</h2>
                <p className="text-sm text-slate-300">
                  Type a prompt, attach up to two images, pick output settings,
                  and hit generate.
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                Prototype
              </span>
            </div>

            <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <label className="text-sm font-medium text-white">
                  Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="E.g. editorial streetwear shot, dusk neon lights, model in layered textures..."
                  rows={5}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-slate-400 shadow-inner shadow-slate-900 focus:border-emerald-400/70 focus:outline-none"
                  required
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <label className="text-sm font-medium text-white">
                    Attach references (max 2)
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    {[0, 1].map((idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-2 rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-sm text-slate-300 transition hover:border-emerald-300/60 hover:bg-white/10"
                      >
                        <p className="text-xs font-medium text-white">
                          Reference {idx + 1}
                        </p>
                        {/* URL Input - this is what Higgsfield uses */}
                        <input
                          type="url"
                          placeholder="Paste image URL (https://...)"
                          value={imageUrls[idx]}
                          onChange={(e) => {
                            const newUrls = [...imageUrls] as [string, string];
                            newUrls[idx] = e.target.value;
                            setImageUrls(newUrls);
                          }}
                          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400/70 focus:outline-none"
                        />
                        {/* Preview from URL */}
                        {imageUrls[idx] && (
                          <div className="overflow-hidden rounded-lg border border-emerald-500/30 bg-black/40">
                            <img
                              src={imageUrls[idx]}
                              alt={`Reference ${idx + 1}`}
                              className="h-20 w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                            <div className="flex items-center justify-between px-2 py-1 text-xs">
                              <span className="truncate text-emerald-200">
                                ✓ URL set
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const newUrls = [...imageUrls] as [string, string];
                                  newUrls[idx] = "";
                                  setImageUrls(newUrls);
                                }}
                                className="rounded-full px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/10"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        )}
                        {/* Divider */}
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="h-px flex-1 bg-white/10" />
                          or preview local
                          <span className="h-px flex-1 bg-white/10" />
                        </div>
                        {/* Local file upload - preview only */}
                        <label className="flex h-16 cursor-pointer flex-col items-center justify-center rounded-lg border border-white/5 bg-black/20 text-center text-xs">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleFileChange(e, idx as 0 | 1)}
                            className="hidden"
                          />
                          <span className="text-slate-400">
                            {files[idx] ? (files[idx] as File).name : "Local preview"}
                          </span>
                        </label>
                        {files[idx] && (
                          <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
                            <img
                              src={URL.createObjectURL(files[idx] as File)}
                              alt={(files[idx] as File).name}
                              className="h-16 w-full object-cover opacity-60"
                            />
                            <p className="px-2 py-1 text-[10px] text-amber-300">
                              ⚠️ Local only — paste URL above to send
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">
                    Paste hosted image URLs (https://...) to send to Higgsfield.
                    Local uploads are for preview only.
                  </p>
                </div>

                <div className="space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
                  <h3 className="text-sm font-semibold text-white">
                    Output settings
                  </h3>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Resolution
                    </label>
                    <select
                      value={resolution}
                      onChange={(e) =>
                        setResolution(e.target.value as Resolution)
                      }
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400/70 focus:outline-none"
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Format
                    </label>
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as Format)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400/70 focus:outline-none"
                    >
                      <option value="jpg">JPG</option>
                      <option value="png">PNG</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Aspect ratio
                    </label>
                    <select
                      value={aspect}
                      onChange={(e) => setAspect(e.target.value as AspectRatio)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400/70 focus:outline-none"
                    >
                      <option value="4:3">4:3</option>
                      <option value="4:5">4:5</option>
                      <option value="5:4">5:4</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-slate-300">
                  {error ? (
                    <span className="text-red-200">{error}</span>
                  ) : (
                    message ?? "Awaiting your prompt..."
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !prompt}
                  className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:-translate-y-0.5 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? "Generating..." : "Generate"}
                </button>
              </div>
            </form>

            {(resultImages.length > 0 || message || error || requestId) && (
              <div className="mt-6 space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Result & status
                    </h3>
                    {requestId && (
                      <p className="text-xs text-slate-400">
                        Request ID: {requestId}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {requestId && (
                      <>
                        <button
                          type="button"
                          onClick={togglePolling}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            isPolling
                              ? "border-amber-400/40 text-amber-100 hover:bg-amber-500/10"
                              : "border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/10"
                          }`}
                        >
                          {isPolling ? `⏸ Stop (${pollCount})` : "▶ Auto-poll"}
                        </button>
                        <button
                          type="button"
                          onClick={refreshStatus}
                          disabled={isLoading || isPolling}
                          className="rounded-full border border-emerald-400/40 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isLoading ? "Checking..." : "Refresh once"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  {isPolling && (
                    <div className="flex items-center gap-2 text-xs text-amber-200">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                      Auto-polling every 20s... (check #{pollCount})
                    </div>
                  )}
                  {error ? (
                    <p className="text-red-200">Error: {error}</p>
                  ) : (
                    <p>{message ?? "Waiting for output..."}</p>
                  )}
                  {queueDetail && (
                    <details className="text-xs text-slate-300">
                      <summary className="cursor-pointer text-slate-200">
                        Queue response
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-black/40 p-2">
                        {JSON.stringify(queueDetail, null, 2)}
                      </pre>
                    </details>
                  )}
                  {serverDetail && (
                    <details className="text-xs text-slate-300">
                      <summary className="cursor-pointer text-slate-200">
                        Latest status payload
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-black/40 p-2">
                        {JSON.stringify(serverDetail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>

                {resultImages.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {resultImages.map((url) => (
                      <div
                        key={url}
                        className="overflow-hidden rounded-lg border border-white/10 bg-black/40"
                      >
                        <img
                          src={url}
                          alt="Generated"
                          className="h-48 w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                Session
              </p>
              <h3 className="text-xl font-semibold text-white">
                Request preview
              </h3>
              <p className="mt-2 text-sm text-slate-300">
                Backend wiring comes next. For now, this captures your prompt,
                attachments, and chosen output config.
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              On submit, we’ll call the image generation API with:
              <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-50/90 marker:text-emerald-300">
                <li>Prompt text</li>
                <li>Up to 2 reference images</li>
                <li>Resolution ({resolution}), format ({format}), aspect ({aspect})</li>
              </ul>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
