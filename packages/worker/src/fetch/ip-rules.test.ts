import { describe, expect, it } from 'vitest';
import { classifyIp, isBlockedIp } from './ip-rules.js';

describe('classifyIp — blocked addresses', () => {
  const blocked: Array<[label: string, ip: string]> = [
    ['loopback IPv4', '127.0.0.1'],
    ['loopback IPv4 (high)', '127.255.255.255'],
    ['RFC1918 10/8', '10.0.0.1'],
    ['RFC1918 172.16/12 (low)', '172.16.0.1'],
    ['RFC1918 172.16/12 (high)', '172.31.255.255'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['cloud metadata (AWS/GCP)', '169.254.169.254'],
    ['link-local IPv4', '169.254.0.1'],
    ['CGNAT 100.64/10', '100.64.0.1'],
    ['unspecified IPv4', '0.0.0.0'],
    ['broadcast', '255.255.255.255'],
    ['loopback IPv6', '::1'],
    ['link-local IPv6', 'fe80::1'],
    ['unique-local IPv6 (ULA)', 'fc00::1'],
    ['unique-local IPv6 (ULA, fd)', 'fd00::1'],
    ['unspecified IPv6', '::'],
    ['IPv4-mapped IPv6 metadata', '::ffff:169.254.169.254'],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped IPv6 private', '::ffff:10.0.0.1'],
    ['multicast IPv4', '224.0.0.1'],
    ['multicast IPv6', 'ff02::1'],
    ['reserved IPv4', '240.0.0.1'],
  ];

  it.each(blocked)('blocks %s (%s)', (_label, ip) => {
    const result = classifyIp(ip);
    expect(result.safe).toBe(false);
    expect(isBlockedIp(ip)).toBe(true);
  });

  it('reports the underlying reason for an IPv4-mapped IPv6 bypass attempt', () => {
    const result = classifyIp('::ffff:169.254.169.254');
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toContain('ipv4-embedded');
      expect(result.reason).toContain('linkLocal');
    }
  });

  it('blocks the deprecated IPv4-COMPATIBLE IPv6 form (::a.b.c.d), unwrapping the inner v4', () => {
    // `::169.254.169.254` (compat, no ffff) embeds the metadata address; it
    // must be unwrapped and classified as the inner IPv4, not trusted by the
    // IPv6 name. Same for a private inner v4.
    for (const ip of ['::169.254.169.254', '::127.0.0.1', '::10.0.0.1']) {
      const result = classifyIp(ip);
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.reason).toContain('ipv4-embedded');
      }
    }
  });

  it('fails closed on unparseable input', () => {
    const result = classifyIp('not-an-ip');
    expect(result.safe).toBe(false);
    if (!result.safe) {
      expect(result.reason).toBe('unparseable-ip');
    }
  });

  it('fails closed on empty string', () => {
    expect(classifyIp('').safe).toBe(false);
  });

  it('fails closed on garbage/overflow input', () => {
    expect(classifyIp('999.999.999.999').safe).toBe(false);
    expect(classifyIp('not.an.ip.address').safe).toBe(false);
    expect(classifyIp('::::').safe).toBe(false);
  });

  it('does not treat shorthand decimal notation as a bypass (1.2.3 = 1.2.0.3, still classified honestly)', () => {
    // ipaddr.js parses shorthand dotted-decimal (1.2.3 -> 1.2.0.3); this is
    // a public address, so it should classify as safe, not throw or block
    // by accident. This pins the behavior rather than asserting a false
    // "bug".
    expect(classifyIp('1.2.3').safe).toBe(true);
    // But the same shorthand pointed at loopback must still be blocked.
    expect(classifyIp('127.1').safe).toBe(false);
  });
});

describe('classifyIp — safe addresses', () => {
  const safe: Array<[label: string, ip: string]> = [
    ['public IPv4 (Google DNS)', '8.8.8.8'],
    ['public IPv4 (Cloudflare DNS)', '1.1.1.1'],
    ['public IPv6 (Cloudflare)', '2606:4700:4700::1111'],
  ];

  it.each(safe)('allows %s (%s)', (_label, ip) => {
    const result = classifyIp(ip);
    expect(result.safe).toBe(true);
    expect(isBlockedIp(ip)).toBe(false);
  });
});
