/**
 * lib/s3.ts — S3 storage for call recordings.
 *
 * Env:
 *   S3_BUCKET            (required)  e.g. limbu-call-recordings
 *   S3_REGION            (required)  e.g. ap-south-1
 *   S3_ACCESS_KEY_ID     (optional)  omit on EC2 with an instance role
 *   S3_SECRET_ACCESS_KEY (optional)
 *   S3_ENDPOINT          (optional)  for S3-compatible stores (R2/MinIO)
 *   S3_PREFIX            (optional)  key prefix, default "call-recordings"
 *
 * Objects stay PRIVATE — playback uses short-lived presigned GET URLs.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client: S3Client | null = null;

export function s3Configured(): boolean {
  return !!(process.env.S3_BUCKET && process.env.S3_REGION);
}

function getClient(): S3Client {
  if (client) return client;
  if (!s3Configured()) throw new Error('S3 not configured — set S3_BUCKET and S3_REGION');
  const creds = process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined; // fall back to instance role / default provider chain
  client = new S3Client({
    region:      process.env.S3_REGION,
    credentials: creds,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });
  return client;
}

const bucket = () => process.env.S3_BUCKET as string;
const prefix = () => (process.env.S3_PREFIX || 'call-recordings').replace(/^\/+|\/+$/g, '');

/** Deterministic object key: <prefix>/ws-<id>/<yyyy>/<mm>/<callId>.<ext> */
export function recordingKey(workspaceId: number, callId: string, ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear(), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const safeId = callId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${prefix()}/ws-${workspaceId}/${yyyy}/${mm}/${safeId}.${ext}`;
}

export async function putRecording(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: bucket(), Key: key, Body: body, ContentType: contentType,
    ServerSideEncryption: 'AES256',
  }));
}

/** Short-lived (default 15 min) URL for in-panel playback / download. */
export async function presignRecording(key: string, expiresInSec = 900, downloadName?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket(), Key: key,
    ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` } : {}),
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: expiresInSec });
}

export async function deleteRecording(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
