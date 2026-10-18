import { useEffect, useRef } from 'react';
import { discardAdminUpload } from '@workspace/api-client-react';
import { uploadImage, type UploadedImage } from '@/lib/images';

// Uploads each picked picture once, however many times the save is tried, and
// asks the server to delete the uploads that were never saved: a picture
// replaced or removed before saving, or left behind when the form goes away.
// The server deletes a file only when nothing uses it.
//
// While a save is running (begin … its end) nothing is deleted: the form may
// close or switch away meanwhile, and the save may yet store that very
// picture. The deletions wait for the save's end, when the database already
// says whether the file is in use.
export function usePictureUploads() {
  const uploads = useRef(new Map<File, UploadedImage>());
  const saving = useRef(0);
  const waiting = useRef<UploadedImage[]>([]);
  const api = useRef({
    async upload(file: File) {
      const known = uploads.current.get(file);
      if (known) return known;
      const image = await uploadImage(file);
      uploads.current.set(file, image);
      return image;
    },
    // A save starts; the function returned ends it (called once, success or not).
    begin() {
      saving.current += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        saving.current -= 1;
        if (saving.current === 0) waiting.current.splice(0).forEach(discard);
      };
    },
    // The save went through: these uploads are in use now.
    saved() {
      uploads.current.clear();
    },
    // Uploads of pictures no longer picked are not needed.
    keepOnly(files: readonly (File | null)[]) {
      for (const [file, image] of uploads.current) {
        if (files.includes(file)) continue;
        uploads.current.delete(file);
        if (saving.current > 0) waiting.current.push(image);
        else discard(image);
      }
    },
  }).current;
  useEffect(() => () => api.keepOnly([]), [api]);
  return api;
}

function discard(image: UploadedImage) {
  void discardAdminUpload({ public_id: image.publicId }).catch(() => undefined);
}
