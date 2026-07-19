import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchMarkdown, buildSearchUrl } from "../lib/sources/streeteasy.js";
import { pickCategories } from "../lib/sources/craigslist.js";
import { diffAgainstSeen } from "../lib/search.js";
import { nearestSubway, findNeighborhood, walkMinutes } from "../lib/geo.js";

test("streeteasy search URL from constraints", () => {
  const url = buildSearchUrl({ neighborhood: "east-village", max_price: 3500, beds: [0, 1] });
  assert.equal(url, "https://streeteasy.com/for-rent/east-village/price:-3500%7Cbeds:0-1");
});

test("streeteasy markdown parser extracts cards", () => {
  const md = `
Some header noise

[331 East Fifth Street #F1](https://streeteasy.com/building/331-east-5-street-new_york/f1)
$3,500
1 bed 1 bath
R New York

[169 Avenue A #14](https://streeteasy.com/building/169-avenue-a-new_york/14)
$2,995
Studio 1 bath
Time Equities

[About us](https://streeteasy.com/about)
`;
  const listings = parseSearchMarkdown(md);
  assert.equal(listings.length, 2);
  assert.equal(listings[0].price_monthly, 3500);
  assert.equal(listings[0].beds, 1);
  assert.equal(listings[1].price_monthly, 2995);
  assert.equal(listings[1].beds, 0);
  assert.ok(listings[0].id.startsWith("se:building/"));
});

test("craigslist category selection follows sublet intent", () => {
  assert.deepEqual(pickCategories({ sublet: true }), ["sub", "apa"]);
  assert.deepEqual(pickCategories({ sublet: false }), ["apa"]);
  assert.deepEqual(pickCategories({}), ["apa"]);
});

test("diffAgainstSeen returns only fresh listings", () => {
  const results = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const { new_listings, returning } = diffAgainstSeen(results, ["b"]);
  assert.deepEqual(new_listings.map((l) => l.id), ["a", "c"]);
  assert.equal(returning.length, 1);
});

test("nearest subway to East Village centroid includes 1st Av area stations", () => {
  const near = nearestSubway(40.7273, -73.984, 3);
  assert.equal(near.length, 3);
  assert.ok(near[0].walk_minutes < 15);
  assert.ok(near[0].routes.length > 0);
});

test("neighborhood alias detection stays word-bounded", () => {
  assert.equal(findNeighborhood("love the les vibe").slug, "lower-east-side");
  assert.equal(findNeighborhood("this is harmless text"), null);
});

test("walk minutes sane", () => {
  assert.ok(walkMinutes(0.25) >= 5 && walkMinutes(0.25) <= 9);
});
