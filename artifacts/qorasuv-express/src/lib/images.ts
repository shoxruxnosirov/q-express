import { createAdminUploadTicket } from '@workspace/api-client-react';

// Every picture the admins put on the site is cropped to its frame in the
// browser, made no larger than its format needs, and only then uploaded to
// Cloudinary. The customer's phone gets a copy sized for where it is shown
// (sizedImage), never the stored file itself.

export type ImageFormat = {
  /** Width / height of the frame the admin crops to. */
  aspect: number;
  /** The stored size; a smaller crop is kept as it is, never enlarged. */
  width: number;
  height: number;
  /** A logo may be see-through; a photo is flattened onto white. */
  transparent: boolean;
  label: string;
};

export const IMAGE_FORMATS = {
  // Square everywhere: the catalog card, the product page, the cart.
  product: { aspect: 1, width: 1200, height: 1200, transparent: false, label: 'Mahsulot rasmi (1:1)' },
  // The shop's card on its page and in the strip of other shops.
  background: { aspect: 4 / 3, width: 1600, height: 1200, transparent: false, label: 'Do‘kon foni (4:3)' },
  // Next to the shop's name: the header, the strip, the admin list.
  icon: { aspect: 1, width: 512, height: 512, transparent: true, label: 'Do‘kon ikonkasi (1:1)' },
} satisfies Record<string, ImageFormat>;

export type ImageFormatName = keyof typeof IMAGE_FORMATS;

/** The part of the picked picture the admin framed, in its own pixels. */
export type CropArea = { x: number; y: number; width: number; height: number };

// A phone camera's photo is far bigger than any frame; this only refuses what
// is not a picture at all or would not fit a browser's memory.
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
// What one upload may weigh after cropping (well above what the formats give).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function sourceProblem(file: File): string | null {
  // Some systems give a HEIC photo no type at all; whether it opens is asked
  // of the browser next (canOpenImage), which then names the problem.
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return 'Faqat rasm fayli yuklanadi.';
  if (file.size > MAX_SOURCE_BYTES) return 'Rasm hajmi 40 MB dan oshmasligi kerak.';
  return null;
}

/** Below this the stored picture is smaller than its format and may look soft. */
export function isLowResolution(area: CropArea, format: ImageFormat) {
  return area.width < format.width * 0.75;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Rasmni ochib bo‘lmadi. Boshqa rasm tanlang.'));
    image.src = src;
  });
}

/** Whether this browser can open the picture at all (Chrome cannot open HEIC). */
export async function canOpenImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    await loadImage(url);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Brauzer rasmni kesa olmadi.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * The framed part of `file`, at most the format's size, as a file ready to
 * upload. Shrunk in halves, so a large photo does not turn grainy as it would
 * in one step. WebP where the browser can write it; else JPEG for a photo and
 * PNG for an icon, which may be see-through.
 */
export async function cropImage(file: File, area: CropArea, format: ImageFormat): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, format.width / area.width);
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(width / format.aspect));

    // At most twice the final size from the start: a 48 MP photo drawn whole
    // would pass what a phone's browser allows for one canvas.
    const first = Math.min(area.width, width * 2) / area.width;
    let { canvas, context } = canvasOf(Math.max(1, Math.round(area.width * first)), Math.max(1, Math.round(area.height * first)));
    if (!format.transparent) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
    // A phone keeps a canvas's memory until it is collected, and allows only
    // so much in all: each one is emptied as soon as it is drawn from.
    const release = (used: HTMLCanvasElement) => {
      used.width = 0;
      used.height = 0;
    };
    while (canvas.width / 2 >= width) {
      const half = canvasOf(Math.round(canvas.width / 2), Math.round(canvas.height / 2));
      half.context.drawImage(canvas, 0, 0, half.canvas.width, half.canvas.height);
      release(canvas);
      ({ canvas, context } = half);
    }
    if (canvas.width !== width || canvas.height !== height) {
      const last = canvasOf(width, height);
      last.context.drawImage(canvas, 0, 0, width, height);
      release(canvas);
      canvas = last.canvas;
    }

    let blob = await toBlob(canvas, 'image/webp', 0.86);
    // A browser that cannot write WebP answers with a PNG instead.
    if (!blob || blob.type !== 'image/webp') {
      blob = format.transparent ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', 0.88);
    }
    release(canvas);
    if (!blob) throw new Error('Brauzer rasmni saqlay olmadi.');
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Rasm hajmi juda katta chiqdi. Boshqa rasm tanlang.');
    const extension = blob.type.split('/')[1] ?? 'jpg';
    const name = file.name.replace(/\.[^.]+$/, '') || 'rasm';
    return new File([blob], `${name}.${extension}`, { type: blob.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type UploadedImage = { url: string; publicId: string };

// The signature authorises one upload and expires within a minute, so it is
// fetched per file rather than cached. The bytes go straight from the browser
// to Cloudinary and never pass through our own server, which sleeps when idle.
export async function uploadImage(file: File): Promise<UploadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Faqat rasm fayli yuklanadi.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Rasm hajmi 10 MB dan oshmasligi kerak.');

  const ticket = await createAdminUploadTicket();
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', ticket.api_key);
  form.append('timestamp', String(ticket.timestamp));
  form.append('folder', ticket.folder);
  form.append('signature', ticket.signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error('Rasm yuklanmadi. Qaytadan urinib ko‘ring.');
  const payload = (await response.json()) as { secure_url?: string; public_id?: string };
  if (!payload.secure_url || !payload.public_id) throw new Error('Rasm yuklandi, lekin manzili qaytmadi.');
  return { url: payload.secure_url, publicId: payload.public_id };
}

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

/**
 * A copy of a Cloudinary picture `width` pixels wide, in the lightest format
 * the phone reads (WebP/AVIF) at an automatic quality. Any other link (an old
 * product's image from elsewhere, a picture being previewed) comes back as is.
 */
export function sizedImage(url: string, width: number) {
  const match = CLOUDINARY_UPLOAD.exec(url);
  if (!match) return url;
  return `${match[1]}f_auto,q_auto,c_limit,w_${width}/${match[2]}`;
}

/**
 * `src` and `srcSet` for an <img>: the phone picks the copy its screen needs
 * (the `sizes` the caller gives says how wide it is shown).
 */
export function imageSources(url: string, widths: number[]) {
  if (!CLOUDINARY_UPLOAD.test(url)) return { src: url };
  return {
    src: sizedImage(url, widths[Math.min(1, widths.length - 1)]),
    srcSet: widths.map(width => `${sizedImage(url, width)} ${width}w`).join(', '),
  };
}
