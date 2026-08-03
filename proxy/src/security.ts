import dns from "node:dns/promises";
import net from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function forbiddenIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function forbiddenIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return forbiddenIpv4(mapped);
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

function isForbiddenIp(address: string): boolean {
  return net.isIP(address) === 4 ? forbiddenIpv4(address) : forbiddenIpv6(address);
}

export async function validatePublicImageUrl(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length < 8 || value.length > 4096) {
    throw new Error("imageUrl must be a valid public HTTP(S) URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("imageUrl must be a valid public HTTP(S) URL");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || !hostname || parsed.username || parsed.password) {
    throw new Error("imageUrl must be a valid public HTTP(S) URL");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isForbiddenIp(hostname)
  ) {
    throw new Error("imageUrl must resolve to a public address");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("imageUrl host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenIp(address))) {
    throw new Error("imageUrl must resolve only to public addresses");
  }

  parsed.hash = "";
  return parsed.toString();
}
