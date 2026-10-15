/**
 * lib/metaUpload.ts — Meta's Resumable Upload API.
 *
 * Returns a file "handle" (not a media id). Handles are what template headers
 * and the WhatsApp business profile picture take; media ids are a different
 * thing and come from POST /{phone-number-id}/media.
 */
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v20.0';

/** Upload failure worth showing verbatim — it carries Meta's own wording. */
export class MetaUploadError extends Error {}

function detail(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') return 'Request timed out';
    return JSON.stringify(err.response?.data);
  }
  return String(err);
}

export async function uploadResumable(
  accessToken: string,
  bytes: Buffer,
  mimeType: string,
): Promise<string> {
  // Step 1 — the upload session belongs to the app behind the token
  let appId: string;
  try {
    const res = await axios.get(`${GRAPH}/app`, { params: { access_token: accessToken } });
    appId = (res.data as { id: string }).id;
  } catch (err) {
    console.error('[metaUpload] get app_id failed:', detail(err));
    throw new MetaUploadError(`Could not retrieve Meta App ID — check your access token. (${detail(err)})`);
  }

  // Step 2 — open the session
  let sessionId: string;
  try {
    const res = await axios.post(`${GRAPH}/${appId}/uploads`, null, {
      params:  { file_length: bytes.length, file_type: mimeType, access_token: accessToken },
      timeout: 30000,
    });
    sessionId = (res.data as { id: string }).id;
  } catch (err) {
    console.error('[metaUpload] create session failed:', detail(err));
    throw new MetaUploadError(`Meta upload session failed: ${detail(err)}`);
  }

  // Step 3 — send the bytes
  try {
    const res = await axios.post(`${GRAPH}/${sessionId}`, bytes, {
      headers: {
        Authorization:  `OAuth ${accessToken}`,
        'Content-Type': mimeType,
        file_offset:    '0',
      },
      maxBodyLength:    Infinity,
      maxContentLength: Infinity,
      timeout:          60000,
    });
    return (res.data as { h: string }).h;
  } catch (err) {
    const d = axios.isAxiosError(err) && err.code === 'ECONNABORTED'
      ? 'Request timed out — file may be too large or connection too slow'
      : detail(err);
    console.error('[metaUpload] file upload failed:', d);
    throw new MetaUploadError(`Meta file upload failed: ${d}`);
  }
}
