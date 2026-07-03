/**
 * IP classification for the SSRF-safe fetch boundary.
 *
 * Classifies a single IP address string as safe (globally-routable unicast)
 * or blocked (anything that could reach internal infrastructure: private,
 * loopback, link-local — including the cloud metadata address
 * 169.254.169.254 — CGNAT, IPv6 unique-local, unspecified, multicast,
 * broadcast, reserved).
 *
 * Fail closed: any address this module cannot positively classify as
 * 'unicast' is blocked. IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`) are
 * unwrapped and the underlying IPv4 address is classified — a mapped
 * internal address is a classic SSRF bypass and must not slip through as
 * "just an IPv6 address".
 */

import ipaddr from 'ipaddr.js';

export type IpClassification = { safe: true } | { safe: false; reason: string };

/**
 * ipaddr.js `.range()` categories that are safe to connect to. Everything
 * else (private, loopback, linkLocal, uniqueLocal, carrierGradeNat,
 * reserved, unspecified, broadcast, multicast, ipv4Mapped, rfc6145,
 * rfc6052, 6to4, teredo, benchmarking, amt, as112, as112v6, orchid2,
 * droneRemoteIdProtocolEntityTags, ...) is blocked.
 */
const SAFE_RANGES: ReadonlySet<string> = new Set(['unicast']);

/**
 * Classify an IP address string. Returns `{ safe: true }` only for a
 * globally-routable unicast address. Anything unparseable, or in any
 * non-unicast range, is blocked — fail closed.
 */
export function classifyIp(ip: string): IpClassification {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return { safe: false, reason: 'unparseable-ip' };
  }

  // IPv4-in-IPv6 forms are a classic bypass: an internal IPv4 embedded in an
  // IPv6 address must be classified as that inner IPv4, not trusted by its
  // IPv6 range name. Cover BOTH the mapped form (`::ffff:169.254.169.254`)
  // and the deprecated IPv4-compatible form (`::169.254.169.254`). ipaddr.js
  // labels both ranges `ipv4Mapped` and `isIPv4MappedAddress()` returns true
  // for both, so unwrap on either signal and re-classify the underlying v4.
  if (
    addr instanceof ipaddr.IPv6 &&
    (addr.isIPv4MappedAddress() || addr.range() === 'ipv4Mapped')
  ) {
    const inner = classifyRange(addr.toIPv4Address().range());
    if (!inner.safe) {
      return { safe: false, reason: `ipv4-embedded:${inner.reason}` };
    }
    return { safe: true };
  }

  return classifyRange(addr.range());
}

function classifyRange(range: string): IpClassification {
  if (SAFE_RANGES.has(range)) {
    return { safe: true };
  }
  return { safe: false, reason: `blocked-range:${range}` };
}

/** Convenience predicate: true if the address must be blocked. */
export function isBlockedIp(ip: string): boolean {
  return !classifyIp(ip).safe;
}
