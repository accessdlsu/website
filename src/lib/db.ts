import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getDB() {
  const { env } = await getCloudflareContext();
  const { DB } = env;
  if (!DB) throw new Error("D1 binding DB is not available");
  return DB;
}
