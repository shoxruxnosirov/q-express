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
export const UPLOAD_FOLDER = "qorasuv-express/products";
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

// A Cloudinary delivery URL ends in "/<public id>.<format>" (after any
// transformations and version). The id claimed must be that very file, not
// some other file of the same account.
export function urlNamesPublicId(imageUrl: string, publicId: string) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(imageUrl).pathname);
  } catch {
    return false;
  }
  const withoutFormat = path.replace(/\.[A-Za-z0-9]+$/, "");
  return publicId !== "" && (path.endsWith(`/${publicId}`) || withoutFormat.endsWith(`/${publicId}`));
}

// A public id is a claim that we own the file and may delete it later. Only
// honour it when the URL really points into our own Cloudinary account and
// names that file. Otherwise a wrong value would either make us delete a
// stranger's file or, worse, delete ours while a page still shows a foreign
// link.
//
// Exactly the address an upload answers with (secure_url): our cloud, a plain
// upload ("/image/upload/", an optional version, no transformations and never
// "/image/fetch/", which would have our account fetch someone else's
// picture), and the file in our own folder.
export function isOwnStoredImage(imageUrl: string | undefined, publicId: string) {
  const config = readConfig();
  if (!imageUrl || !config || !isOwnImageUrl(imageUrl)) return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(imageUrl).pathname);
  } catch {
    return false;
  }
  const match = new RegExp(`^/${escapeRegExp(config.cloudName)}/image/upload/(?:v\\d+/)?(.+?)(?:\\.[A-Za-z0-9]+)?$`).exec(path);
  return Boolean(match) && match![1] === publicId && publicId.startsWith(`${STORE_FOLDER}/`);
}

// Every picture of ours lives under this folder (see UPLOAD_FOLDER).
const STORE_FOLDER = "qorasuv-express";

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A copy of one of our pictures `width` pixels wide, in the lightest format
// the viewer reads (as the web app asks for it, lib/images.ts); any other
// link comes back as it is.
export function sizedImageUrl(url: string, width: number) {
  const match = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(url);
  return match ? `${match[1]}f_auto,q_auto,c_limit,w_${width}/${match[2]}` : url;
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
