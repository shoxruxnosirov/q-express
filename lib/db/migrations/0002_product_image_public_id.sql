-- Product images move from pasted third-party links to files the shop owns in
-- Cloudinary. Deleting a file needs its Cloudinary public id, which cannot be
-- derived from the delivery URL reliably, so it is stored alongside the URL.
--
-- Nullable on purpose: products created before the upload flow existed hold a
-- link to somebody else's server. There is nothing of ours to delete for them,
-- and a NULL says exactly that.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "image_public_id" text;
