import { createHash } from "node:crypto";

// Product images are uploaded straight from the operator's browser to
// Cloudinary and only the resulting URL and public id come back through this
// API. The bytes never pass through this server, which matters because the
// free Render instance sleeps after 15 minutes and would otherwise have to
// wake up and relay every upload.
//
// The API secret stays here. The browser receives a signature that is valid
// for one upload into one folder, and nothing else.

const CLOUDINARY_API = "https://api.cloudinary.com/v1_1";
const UPLOAD_FOLDER = "qorasuv-express/products";
// Cloudinary rejects a signature whose timestamp has drifted too far, and a
// stale one is useless to an attacker. One minute is enough for a person to
// pick a file.
const SIGNATURE_TTL_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 15_000;

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export class CloudinaryNotConfiguredError extends Error {
  constructor() {
    super("Cloudinary is not configured");
    this.name = "CloudinaryNotConfiguredError";
  }
}

function readConfig(): CloudinaryConfig | undefined {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return undefined;
  return { cloudName, apiKey, apiSecret };
}

export function isCloudinaryConfigured() {
  return readConfig() !== undefined;
}

function requireConfig(): CloudinaryConfig {
  const config = readConfig();
  if (!config) throw new CloudinaryNotConfiguredError();
  return config;
}

// Cloudinary signs the parameters it will receive, sorted by name and joined
// as a query string, with the API secret appended. Every parameter the browser
// sends must appear here or the upload is rejected, which is what stops the
// browser from quietly widening what the signature permits.
function sign(params: Record<string, string | number>, apiSecret: string) {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
}

export type UploadTicket = {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
  expires_in: number;
};

export function createUploadTicket(): UploadTicket {
  const config = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { folder: UPLOAD_FOLDER, timestamp };
  return {
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    timestamp,
    folder: UPLOAD_FOLDER,
    signature: sign(signed, config.apiSecret),
    expires_in: SIGNATURE_TTL_SECONDS,
  };
}

// A delivery URL for our own cloud always carries the cloud name in its path.
// The browser reports back the URL it received, and this keeps a mistyped or
// forged value from being stored as though we owned the file.
export function isOwnImageUrl(url: string) {
  const config = readConfig();
  if (!config) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "res.cloudinary.com") return false;
  return parsed.pathname.startsWith(`/${config.cloudName}/`);
}

export type DeleteOutcome = { deleted: boolean; reason?: string };

// Deleting is best effort by design. Every caller has already committed the
// database change, so a failure here leaves an unreferenced file in Cloudinary
// rather than a product row pointing at an image that is gone.
export async function deleteImage(publicId: string): Promise<DeleteOutcome> {
  const config = readConfig();
  if (!config) return { deleted: false, reason: "Cloudinary is not configured" };

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ public_id: publicId, timestamp }, config.apiSecret);
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: config.apiKey,
    signature,
  });

  try {
    const response = await fetch(`${CLOUDINARY_API}/${config.cloudName}/image/destroy`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { deleted: false, reason: `Cloudinary responded ${response.status}` };
    }
    const payload = (await response.json()) as { result?: string };
    // "not found" means the file is already gone, which is the state we wanted.
    if (payload.result === "ok" || payload.result === "not found") {
      return { deleted: true };
    }
    return { deleted: false, reason: payload.result ?? "unknown Cloudinary result" };
  } catch (error) {
    return { deleted: false, reason: error instanceof Error ? error.message : "request failed" };
  }
}
