export class RenderMediaIngestError extends Error {
  code: string;
  retryable: boolean;
  details: Record<string, unknown>;

  constructor(code: string, message: string, retryable = false, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RenderMediaIngestError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

const sha256Pattern = /^[a-f0-9]{64}$/i;

export function validRenderMediaHash(value: unknown) {
  return sha256Pattern.test(String(value || '').trim());
}

export function canonicalRenderMediaUri(hash: string) {
  const normalized = String(hash || '').trim().toLowerCase();
  if (!validRenderMediaHash(normalized)) {
    throw new RenderMediaIngestError('RENDER_MEDIA_HASH_INVALID', 'Render media SHA-256 is invalid.');
  }
  return 'parable://render/' + normalized;
}

export function parseCanonicalRenderMediaUri(value: unknown) {
  const match = /^parable:\/\/render\/([a-f0-9]{64})$/i.exec(String(value || '').trim());
  return match ? match[1].toLowerCase() : null;
}

export function validateProviderAssetUrl(value: unknown) {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new RenderMediaIngestError('RENDER_MEDIA_SOURCE_URL_INVALID', 'Provider output did not contain a valid media URL.');
  }

  if (url.protocol !== 'https:') {
    throw new RenderMediaIngestError(
      'RENDER_MEDIA_SOURCE_URL_UNSAFE',
      'PARABLE only ingests provider media over HTTPS.'
    );
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new RenderMediaIngestError(
      'RENDER_MEDIA_SOURCE_URL_UNSAFE',
      'Provider media URL points to a local/private network target.'
    );
  }

  return url.toString();
}

export function parseDeclaredLength(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function detectRenderMediaType(bytes: Uint8Array, declaredType?: string | null) {
  const declared = String(declaredType || '').split(';')[0].trim().toLowerCase();

  const mp4Family = bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp';
  if (mp4Family) {
    if (declared === 'video/quicktime') return 'video/quicktime';
    return 'video/mp4';
  }

  const webm =
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3;
  if (webm) return 'video/webm';

  throw new RenderMediaIngestError(
    'RENDER_MEDIA_SIGNATURE_INVALID',
    'Provider output is not a recognized MP4/QuickTime/WebM video container.'
  );
}

export async function readBoundedResponseBody(response: Response, maxBytes: number) {
  const declared = parseDeclaredLength(response.headers.get('content-length'));
  if (declared !== null && declared > maxBytes) {
    throw new RenderMediaIngestError(
      'RENDER_MEDIA_TOO_LARGE',
      'Rendered clip exceeds the configured immutable-ingestion limit.',
      false,
      { byte_length: declared, max_bytes: maxBytes }
    );
  }

  if (!response.body) {
    throw new RenderMediaIngestError('RENDER_MEDIA_EMPTY', 'Provider returned no media body.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('render media exceeds bounded ingestion limit').catch(() => {});
        throw new RenderMediaIngestError(
          'RENDER_MEDIA_TOO_LARGE',
          'Rendered clip exceeded the configured immutable-ingestion limit while streaming.',
          false,
          { byte_length: total, max_bytes: maxBytes }
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!total) {
    throw new RenderMediaIngestError('RENDER_MEDIA_EMPTY', 'Provider returned an empty media body.');
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
