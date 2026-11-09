import { BlockList, isIP } from "node:net";

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; message: string };

const MAX_URL_LENGTH = 2048;
const PRIVATE_ADDRESS_MESSAGE =
  "That address points to a private or local network, which we don't check.";

// Addresses that aren't the public internet. Our server must never fetch these
// on a visitor's behalf: they can reach internal or cloud-metadata services.
const NON_PUBLIC_ADDRESSES = new BlockList();
const IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const IPV6_RANGES: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];
for (const [network, prefix] of IPV4_RANGES) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of IPV6_RANGES) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return NON_PUBLIC_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** Turns what a visitor typed into a URL we're willing to fetch. */
export function parseUserUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Please enter a website address." };
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, message: "That address is too long." };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      ok: false,
      message: "That doesn't look like a valid address. Try something like example.com.",
    };
  }
  return checkFetchable(url);
}

/** Also runs on every redirect, since a public site can redirect anywhere. */
export function checkFetchable(url: URL): UrlCheck {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Only http and https addresses are supported." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Addresses containing a username or password aren't supported." };
  }
  if (url.port) {
    return { ok: false, message: "Addresses with a custom port aren't supported." };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(hostname)) {
    return isNonPublicAddress(hostname)
      ? { ok: false, message: PRIVATE_ADDRESS_MESSAGE }
      : { ok: true, url };
  }
  if (
    hostname === "localhost" ||
    /\.(localhost|local|internal)\.?$/.test(hostname)
  ) {
    return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
  }
  if (!hostname.includes(".")) {
    return {
      ok: false,
      message: "That doesn't look like a full address. Try something like example.com.",
    };
  }
  return { ok: true, url };
}

export { PRIVATE_ADDRESS_MESSAGE };
