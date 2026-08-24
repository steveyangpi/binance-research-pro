import { lookup } from 'node:dns/promises';
import { createWriteStream, mkdirSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
import ipaddr from 'ipaddr.js';

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type ValidatedRemoteUrl = {
  url: URL;
  hostname: string;
  address: ResolvedAddress;
};

function normalizeAddress(address: string): ResolvedAddress | undefined {
  const normalized = address.replace(/^\[|\]$/g, '');
  if (!ipaddr.isValid(normalized)) return undefined;
  const parsed = ipaddr.process(normalized);
  if (parsed.range() !== 'unicast') return undefined;
  return {
    address: parsed.toString(),
    family: parsed.kind() === 'ipv4' ? 4 : 6,
  };
}

/** Reject non-public destinations before a warehouse URL download. */
export function isDisallowedAddress(address: string): boolean {
  return normalizeAddress(address) === undefined;
}

async function validateRemoteUrl(rawUrl: string): Promise<ValidatedRemoteUrl> {
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
  const resolved = isIP(bareHostname)
    ? [bareHostname]
    : (await lookup(bareHostname, { all: true, verbatim: true })).map(({ address }) => address);
  const addresses = resolved.map(normalizeAddress);
  if (addresses.some((address) => address === undefined) || addresses.length === 0) {
    throw new Error('Non-public, private and loopback IP import URLs are not allowed.');
  }

  return { url, hostname: bareHostname, address: addresses[0]! };
}

function requestValidatedUrl(
  remote: ValidatedRemoteUrl,
  timeoutMs: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      remote.url,
      {
        headers: { host: remote.url.host },
        lookup: (_hostname, _options, callback) =>
          callback(null, remote.address.address, remote.address.family),
        servername: isIP(remote.hostname) === 0 ? remote.hostname : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      },
      resolve,
    );
    request.once('error', reject);
    request.end();
  });
}

export async function downloadToFile(
  rawUrl: string,
  destination: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<void> {
  let remote = await validateRemoteUrl(rawUrl);
  let response: IncomingMessage | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await requestValidatedUrl(remote, timeoutMs);
    if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) break;
    const location = response.headers.location;
    response.resume();
    if (location === undefined) throw new Error('Download redirect does not include a location.');
    if (redirects === 5) throw new Error('Download exceeded five HTTPS redirects.');
    remote = await validateRemoteUrl(new URL(location, remote.url).toString());
  }
  if (response === undefined) throw new Error('Download did not return a response.');
  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
    throw new Error(`Download failed with HTTP ${response.statusCode ?? 0}.`);
  }

  const contentLength = response.headers['content-length'];
  const declaredLength = Number(
    Array.isArray(contentLength) ? contentLength[0] : (contentLength ?? 0),
  );
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
  await pipeline(response, byteLimit, createWriteStream(destination, { flags: 'wx' }));
}
