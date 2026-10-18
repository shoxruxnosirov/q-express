import { eq, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ordersTable, productsTable, shopsTable } from "@workspace/db/schema";
import { deleteImage } from "./cloudinary";

// The pictures stored in our Cloudinary account: product images, and each
// shop's card background and icon. One account serves every shop.

type Log = { warn: (details: object, message: string) => void };

// Deleting the stored file is best effort and never fails the request. The
// database row is already written by the time this runs, so a failure leaves
// an unreferenced file in Cloudinary rather than a page whose image is gone.
// One file may be claimed by several rows (another shop pointing at the same
// file): it goes only once no product and no shop still uses it, and no
// order shows it: an order keeps the picture its products had when it was
// placed (the admin's order list, the link in the bot's order message).
export async function discardStoredImage(log: Log, publicId: string | null | undefined) {
  if (!publicId) return;
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.imagePublicId, publicId))
    .limit(1);
  if (product) return;
  const [shop] = await db
    .select({ id: shopsTable.id })
    .from(shopsTable)
    .where(or(eq(shopsTable.backgroundPublicId, publicId), eq(shopsTable.iconPublicId, publicId)))
    .limit(1);
  if (shop) return;
  // Rare (a product's picture replaced or the product deleted), so a plain
  // search of the orders' lines will do. strpos, not LIKE: an id may hold "_".
  const [ordered] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    // "…/<id>.jpg" or, for an address without an extension, "…/<id>" closing
    // the JSON string.
    .where(sql`strpos(${ordersTable.items}::text, ${"/" + publicId + "."}) > 0 or strpos(${ordersTable.items}::text, ${"/" + publicId + '"'}) > 0`)
    .limit(1);
  if (ordered) return;
  const outcome = await deleteImage(publicId);
  if (!outcome.deleted) {
    log.warn({ publicId, reason: outcome.reason }, "Stored image delete failed");
  }
}
