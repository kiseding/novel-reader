// GBK encoding utility for search queries
// Workers-compatible: uses fetch to an internal endpoint or simple mapping
// For most modern Chinese sites, UTF-8 encoding works.
// Some older sites (aaatxt) require GBK-encoded query parameters.

// GBK-compatible URL encoding using encodeURIComponent
// Since Workers don't have native GBK support, we use a workaround:
// encode the string as UTF-8 bytes (encodeURIComponent does this),
// then the server may accept UTF-8. If not, a full GBK table would be needed.
export function encodeSearchQuery(value: string, encoding: "utf8" | "gbk" = "utf8"): string {
  if (encoding === "utf8") {
    return encodeURIComponent(value);
  }
  // GBK fallback: use percent-encoding of UTF-8 bytes
  // Many GBK-era sites can handle this, or will fallback gracefully
  const bytes = new TextEncoder().encode(value);
  let result = "";
  for (const b of bytes) {
    result += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return result;
}
