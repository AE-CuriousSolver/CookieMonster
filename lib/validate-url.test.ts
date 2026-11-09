import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonPublicAddress, parseUserUrl } from "./validate-url.ts";

test("accepts normal addresses and defaults to https", () => {
  const cases: [string, string][] = [
    ["example.com", "https://example.com/"],
    ["  example.com/about  ", "https://example.com/about"],
    ["http://example.com", "http://example.com/"],
    ["https://www.example.co.uk/", "https://www.example.co.uk/"],
    ["https://8.8.8.8", "https://8.8.8.8/"],
  ];
  for (const [input, expected] of cases) {
    const result = parseUserUrl(input);
    assert.ok(result.ok, input);
    assert.equal(result.url.href, expected);
  }
});

test("rejects things that aren't website addresses", () => {
  const inputs = [
    "",
    "   ",
    "not a url",
    "hello",
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:someone@example.com",
    "https://user:pass@example.com",
    "https://example.com:8080",
    `https://example.com/${"a".repeat(2100)}`,
  ];
  for (const input of inputs) {
    assert.equal(parseUserUrl(input).ok, false, input);
  }
});

test("rejects private and local addresses however they're written", () => {
  const inputs = [
    "localhost",
    "http://localhost",
    "printer.local",
    "db.internal",
    "127.0.0.1",
    "http://2130706433",
    "http://0x7f.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[fd00::1]",
  ];
  for (const input of inputs) {
    assert.equal(parseUserUrl(input).ok, false, input);
  }
});

test("classifies resolved addresses", () => {
  assert.equal(isNonPublicAddress("93.184.216.34"), false);
  assert.equal(isNonPublicAddress("2606:4700::1111"), false);
  assert.equal(isNonPublicAddress("10.1.2.3"), true);
  assert.equal(isNonPublicAddress("::ffff:10.1.2.3"), true);
  assert.equal(isNonPublicAddress("not-an-ip"), true);
});
