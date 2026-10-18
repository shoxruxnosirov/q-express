import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Cropper, { type Area } from 'react-easy-crop';
import { ImagePlus, LoaderCircle, ShoppingBasket, Store, Trash2, TriangleAlert, ZoomIn } from 'lucide-react';
import { canOpenImage, cropImage, IMAGE_FORMATS, isLowResolution, sizedImage, sourceProblem, type ImageFormatName } from '@/lib/images';

// A picture for the site, picked by an admin: it opens in a frame of its
// format's shape, the admin moves and zooms it, and what is inside the frame
// becomes the file (no larger than the format). It is held here and uploaded
// only when the form is saved, so abandoning an edit leaves nothing behind in
// the image store.

const PREVIEW: Record<ImageFormatName, string> = {
  product: 'h-16 w-16 rounded-xl',
  background: 'h-[72px] w-24 rounded-xl',
  icon: 'h-16 w-16 rounded-2xl',
};

export function ImageField({
  format,
  currentUrl,
  file,
  onPick,
  onRemove,
  disabled = false,
  testId,
}: {
  format: ImageFormatName;
  currentUrl?: string | null;
  file: File | null;
  onPick: (file: File | null) => void;
  /** Offered while there is a picture, for one the form may leave out. */
  onRemove?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | undefined>(currentUrl ? sizedImage(currentUrl, 256) : undefined);
  const [source, setSource] = useState<File | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!file) {
      setPreview(currentUrl ? sizedImage(currentUrl, 256) : undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, currentUrl]);

  const pick = async (picked: File | undefined) => {
    // The same file may be picked again after a cancelled crop.
    if (inputRef.current) inputRef.current.value = '';
    if (!picked) return;
    const wrong = sourceProblem(picked);
    if (wrong) return setProblem(wrong);
    // A picture the browser cannot open (HEIC from a desktop or an Android
    // phone) would leave the frame empty with nothing to press: said here.
    if (!(await canOpenImage(picked))) {
      return setProblem('Bu rasmni brauzer ocha olmadi (masalan, HEIC). JPG yoki PNG rasm tanlang.');
    }
    setProblem('');
    setSource(picked);
  };

  const Empty = format === 'product' ? ShoppingBasket : format === 'icon' ? Store : ImagePlus;
  return (
    <div className="flex items-center gap-3" data-testid={testId}>
      <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--card))] ${PREVIEW[format]}`}>
        {preview
          ? <img src={preview} alt="" className="h-full w-full object-cover" />
          : <Empty size={20} strokeWidth={1.3} className="text-[hsl(var(--muted-foreground))]" />}
      </div>
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={event => void pick(event.target.files?.[0])}
          className="hidden"
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="tap flex items-center gap-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] disabled:opacity-50"
          >
            <ImagePlus size={14} /> {preview ? 'Rasmni almashtirish' : 'Rasm tanlash'}
          </button>
          {onRemove && preview && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { onPick(null); onRemove(); }}
              className="tap flex items-center gap-1.5 rounded-xl border border-[#e6b2a8] px-3 py-2 text-xs font-bold text-[#9d493e] disabled:opacity-50"
            >
              <Trash2 size={13} /> Olib tashlash
            </button>
          )}
        </div>
        {file && (
          <p className="mt-1 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
            {IMAGE_FORMATS[format].label} · saqlanganda yuklanadi
          </p>
        )}
        {problem && <p role="alert" className="mt-1 text-[11px] font-semibold text-[#9d493e]">{problem}</p>}
      </div>
      {source && (
        <ImageCropper
          source={source}
          format={format}
          onCancel={() => setSource(null)}
          onDone={cropped => { setSource(null); onPick(cropped); }}
        />
      )}
    </div>
  );
}

// The frame: drag to move, pinch, wheel or the slider to zoom.
function ImageCropper({
  source,
  format,
  onCancel,
  onDone,
}: {
  source: File;
  format: ImageFormatName;
  onCancel: () => void;
  onDone: (file: File) => void;
}) {
  const shape = IMAGE_FORMATS[format];
  const [url, setUrl] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(source);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source]);

  const done = async () => {
    if (!area) return;
    setBusy(true);
    setError('');
    try {
      onDone(await cropImage(source, area, shape));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Rasmni kesib bo‘lmadi.');
      setBusy(false);
    }
  };

  const soft = area ? isLowResolution(area, shape) : false;
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[hsl(var(--foreground)/.5)] backdrop-blur-sm" />
        <Dialog.Content
          data-testid="dialog-crop-image"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[0_24px_60px_rgba(20,40,34,.3)] outline-none"
        >
          <Dialog.Title className="text-sm font-extrabold">{shape.label}</Dialog.Title>
          <p className="-mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Rasmni barmoq bilan suring va kattalashtiring. Ramka ichidagi qism saqlanadi.</p>
          <div className="relative h-[min(56dvh,380px)] w-full overflow-hidden rounded-xl bg-[#1d2420]">
            {url && (
              <Cropper
                image={url}
                crop={crop}
                zoom={zoom}
                aspect={shape.aspect}
                minZoom={1}
                maxZoom={6}
                zoomSpeed={0.25}
                showGrid
                restrictPosition
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            )}
          </div>
          <label className="flex items-center gap-3 text-xs font-bold">
            <ZoomIn size={16} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
            <span className="sr-only">Kattalashtirish</span>
            <input
              type="range"
              min={1}
              max={6}
              step={0.01}
              value={zoom}
              onChange={event => setZoom(Number(event.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </label>
          {soft && (
            <p data-testid="text-crop-low-resolution" className="flex items-start gap-2 rounded-xl bg-[#fff6dc] p-2.5 text-[11px] font-semibold text-[#7a4f07]">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              Rasm sifati past ({Math.round(area!.width)}×{Math.round(area!.height)} px, kerakli {shape.width}×{shape.height}): telefonda xira ko‘rinishi mumkin. Kamroq kattalashtiring yoki kattaroq rasm tanlang.
            </p>
          )}
          {error && <p role="alert" className="rounded-xl bg-[#fdf0ed] p-2.5 text-[11px] font-semibold text-[#9d493e]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={busy} className="h-10 rounded-xl border border-[hsl(var(--border))] px-4 text-xs font-bold disabled:opacity-50">Bekor qilish</button>
            <button type="button" onClick={() => void done()} disabled={busy || !area} data-testid="button-crop-done" className="tap flex h-10 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 text-xs font-extrabold text-white disabled:opacity-50">
              {busy && <LoaderCircle size={14} className="animate-spin" />} Tayyor
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
