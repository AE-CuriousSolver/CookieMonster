import assert from "node:assert/strict";
import { test } from "node:test";
import { RecentResults } from "./recent-results.ts";

function withClock() {
  const clock = { time: 0 };
  return { clock, now: () => clock.time };
}

test("returns a saved value until it is too old", () => {
  const { clock, now } = withClock();
  const recent = new RecentResults<string>(1000, 10, now);
  recent.set("a", "first");

  clock.time = 1000;
  assert.equal(recent.get("a"), "first");
  clock.time = 1001;
  assert.equal(recent.get("a"), undefined);
});

test("drops the oldest value when full", () => {
  const recent = new RecentResults<string>(1000, 2);
  recent.set("a", "1");
  recent.set("b", "2");
  recent.set("c", "3");
  assert.equal(recent.get("a"), undefined);
  assert.equal(recent.get("b"), "2");
  assert.equal(recent.get("c"), "3");
});
