-- A shop's own pictures: the background of its storefront card (cropped 4:3)
-- and its icon (square). Both are files in our Cloudinary account, uploaded
-- from the admin's browser; the public id is kept so a replaced file can be
-- deleted, as for product images (0002).
--
-- Nullable: a shop without them shows its card on the plain card colour and
-- the generic shop icon.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "background_url" text,
  ADD COLUMN IF NOT EXISTS "background_public_id" text,
  ADD COLUMN IF NOT EXISTS "icon_url" text,
  ADD COLUMN IF NOT EXISTS "icon_public_id" text;
