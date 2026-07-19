import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../lib/query.js";

test("matt's canonical query parses", () => {
  const c = parseQuery(
    "1 bed or studio in East Village under $3500, ideally a 15 minute walk to the train, citibike nearby, lots of natural light",
  );
  assert.equal(c.neighborhood, "east-village");
  assert.deepEqual(c.beds, [0, 1]);
  assert.equal(c.max_price, 3500);
  assert.equal(c.max_subway_walk_minutes, 15);
  assert.equal(c.citibike_nearby, true);
  assert.ok(c.features.includes("natural_light"));
});

test("alias neighborhoods resolve", () => {
  assert.equal(parseQuery("2br in the LES under 4k").neighborhood, "lower-east-side");
  assert.equal(parseQuery("studio in bed-stuy").neighborhood, "bedford-stuyvesant");
  assert.equal(parseQuery("1 bedroom williamsburg").neighborhood, "williamsburg");
});

test("price forms", () => {
  assert.equal(parseQuery("studio under 4k in soho").max_price, 4000);
  assert.equal(parseQuery("max $2,800 one bed in astoria").max_price, 2800);
  assert.equal(parseQuery("up to 3200 in greenpoint").max_price, 3200);
});

test("no false positives on empty query", () => {
  const c = parseQuery("somewhere nice");
  assert.equal(c.neighborhood, null);
  assert.equal(c.beds, null);
  assert.equal(c.max_price, null);
});

test("subway line extraction", () => {
  const c = parseQuery("1 bed near the L train in bushwick");
  assert.deepEqual(c.subway_lines, ["L"]);
});

test("sublet detection", () => {
  const c = parseQuery("3 month sublet in williamsburg under $2800, furnished");
  assert.equal(c.sublet, true);
  assert.equal(c.duration_months, 3);
  assert.ok(c.features.includes("furnished"));

  assert.equal(parseQuery("short-term studio in astoria").sublet, true);
  assert.equal(parseQuery("subletting my 1br in the LES").sublet, true);
  assert.equal(parseQuery("1 bed for 4 months in greenpoint").sublet, true);
});

test("regular searches are not sublets", () => {
  assert.equal(parseQuery("1 bed in east village under $3500").sublet, false);
  // A 12-month term is a normal lease, not a sublet.
  const yearLease = parseQuery("12 month lease 1br chelsea");
  assert.equal(yearLease.sublet, false);
  assert.equal(yearLease.duration_months, 12);
});
