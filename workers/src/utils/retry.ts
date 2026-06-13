// Retry utility — mirrors go-novel-dl's shouldRetrySiteRequest + siteRetryDelay
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!shouldRetry(e) || attempt === maxAttempts - 1) {
        throw e;
      }
      // siteRetryDelay: (attempt+1) * 1s
      await sleep((attempt + 1) * 1000);
    }
  }
  throw lastErr!;
}

function shouldRetry(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  // Match Go's shouldRetrySiteRequest patterns
  const retryPatterns = [
    "context deadline exceeded",
    "client.timeout",
    "timeout awaiting headers",
    "timeout awaiting response",
    "tls handshake timeout",
    "i/o timeout",
    "connection reset by peer",
    "connection refused",
    "eof",
    "no such host",
    "network is unreachable",
    "broken pipe",
    "too many open files",
    "use of closed network connection",
    "server misbehaving",
  ];
  return retryPatterns.some((p) => msg.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
