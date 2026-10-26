import { AwsClient } from "aws4fetch";

export class R2Error extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function r2Configured(): boolean {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function client(): AwsClient {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !process.env.R2_ACCOUNT_ID) {
    throw new Error("Le stockage Cloudflare n'est pas configuré.");
  }
  return new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
}

function objectUrl(key: string): string {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET || "codecapture";
  const path = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`;
}

function etagOf(header: string | null): string | null {
  const value = header?.trim();
  return value || null;
}

export async function r2Get(key: string): Promise<{ body: Uint8Array; etag: string | null } | null> {
  const response = await client().fetch(objectUrl(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new R2Error(response.status, "Lecture du stockage impossible.");
  return { body: new Uint8Array(await response.arrayBuffer()), etag: etagOf(response.headers.get("etag")) };
}

export async function r2Put(key: string, body: Uint8Array | string, contentType: string, ifMatch?: string | null): Promise<void> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (ifMatch) headers["if-match"] = ifMatch;
  const payload = typeof body === "string" ? body : Buffer.from(body);
  const response = await client().fetch(objectUrl(key), { method: "PUT", body: payload, headers });
  if (response.status === 412 || response.status === 409) throw new R2Error(response.status, "Le stockage est occupé.");
  if (!response.ok) throw new R2Error(response.status, "Écriture du stockage impossible.");
}

export async function r2Del(key: string): Promise<void> {
  const response = await client().fetch(objectUrl(key), { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) throw new R2Error(response.status, "Suppression impossible.");
}
