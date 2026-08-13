import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { createWriteStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { dirname } from 'node:path';

/** Reject non-public destinations before a warehouse URL download. */
export function isDisallowedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
    const first = octets[0] ?? 0;
    const second = octets[1] ?? 0;
    const third = octets[2] ?? 0;
    return (
      first === 10 ||
      first === 127 ||
      first === 0 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }
  if (ipVersion !== 6) return false;
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (isIP(mappedIpv4) === 4) return isDisallowedAddress(mappedIpv4);
  }
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') ||
    normalized === '2001:db8::'
  );
}

async function validateRemoteUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS warehouse imports are allowed.');
  if (url.username !== '' || url.password !== '') {
    throw new Error('Warehouse import URLs must not contain credentials.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost import URLs are not allowed.');
  }
  const bareHostname = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(bareHostname)
    ? [{ address: bareHostname }]
    : await lookup(bareHostname, { all: true, verbatim: true });
  if (addresses.some(({ address }) => isDisallowedAddress(address))) {
    throw new Error('Non-public, private and loopback IP import URLs are not allowed.');
  }
  return url;
}

export async function downloadToFile(
  rawUrl: string,
  destination: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<void> {
  let url = await validateRemoteUrl(rawUrl);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (location === null) throw new Error('Download redirect does not include a location.');
    if (redirects === 5) throw new Error('Download exceeded five HTTPS redirects.');
    url = await validateRemoteUrl(new URL(location, url).toString());
  }
  if (response === undefined) throw new Error('Download did not return a response.');
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) {
    throw new Error(`Download is larger than WAREHOUSE_MAX_IMPORT_BYTES (${maxBytes}).`);
  }

  let receivedBytes = 0;
  const byteLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(new Error(`Download exceeded WAREHOUSE_MAX_IMPORT_BYTES (${maxBytes}).`));
        return;
      }
      callback(null, chunk);
    },
  });
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    byteLimit,
    createWriteStream(destination, { flags: 'wx' }),
  );
}
