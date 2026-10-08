export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export interface IndexNowRequest {
  endpoint: string;
  body: { host: string; key: string; keyLocation: string; urlList: string[] };
}

/**
 * Build an IndexNow submission. URLs must belong to the host; others are dropped.
 * The key file is served by the site at /<key>.txt.
 */
export function buildIndexNowRequest(siteUrl: string, key: string, urls: string[]): IndexNowRequest {
  const base = new URL(siteUrl);
  const unique = [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === base.host;
    } catch {
      return false;
    }
  });
  return {
    endpoint: INDEXNOW_ENDPOINT,
    // IndexNow accepts up to 10,000 URLs per request.
    body: { host: base.host, key, keyLocation: `${base.origin}/${key}.txt`, urlList: unique.slice(0, 10000) },
  };
}
