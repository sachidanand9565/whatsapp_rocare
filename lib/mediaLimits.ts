/**
 * WhatsApp Cloud API media constraints — mime types & max size per category.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export const MEDIA_LIMITS: Record<MediaKind, { mimes: string[]; maxMB: number; label: string }> = {
  image: {
    mimes: ['image/jpeg', 'image/png'],
    maxMB: 5,
    label: 'JPG, PNG',
  },
  video: {
    mimes: ['video/mp4', 'video/3gpp', 'video/3gp'],
    maxMB: 16,
    label: 'MP4, 3GP',
  },
  audio: {
    mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    maxMB: 16,
    label: 'AAC, MP4, MP3, AMR, OGG (Opus)',
  },
  document: {
    mimes: [
      'text/plain',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxMB: 100,
    label: 'PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT',
  },
};

export function classifyMedia(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function validateMediaFile(mimeType: string, sizeBytes: number): { ok: true; kind: MediaKind } | { ok: false; error: string } {
  const kind  = classifyMedia(mimeType);
  const limit = MEDIA_LIMITS[kind];

  if (!limit.mimes.includes(mimeType)) {
    return { ok: false, error: `Unsupported ${kind} type "${mimeType || 'unknown'}". WhatsApp allows: ${limit.label}` };
  }
  const maxBytes = limit.maxMB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return { ok: false, error: `File is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB — WhatsApp allows up to ${limit.maxMB} MB for ${kind}` };
  }
  return { ok: true, kind };
}
