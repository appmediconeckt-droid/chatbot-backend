import PrivateAsset from "../models/PrivateAsset.js";
import { privateAssetId } from "./privateAssets.js";

// Existing provider URLs remain usable during migration. New references must
// resolve to this account's private storage, with storage metadata from the server.
export async function resolveProfileAsset(url, ownerId, purpose, existing = []) {
  const previous = existing.find(asset => asset?.url === url);
  if (previous) return previous;
  const id = privateAssetId(url);
  if (!id) return null;
  const asset = await PrivateAsset.findOne({
    _id: id, ownerId, purpose, prescriptionId: { $exists: false },
  });
  if (!asset) return null;
  return { url, publicId: `private:${asset._id}`, bytes: asset.size, name: asset.name };
}
