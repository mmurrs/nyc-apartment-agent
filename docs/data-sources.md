# NYC Sublet Data Sources — Option Matrix

Researched 2026-07-17. Purpose: where the NYC sublet inventory actually lives, what we can
legally/practically ingest, and in what order to build. Current adapters: StreetEasy (paid
Firecrawl via stableenrich), Craigslist (`cat=apa` + `cat=sub`), The Listings Project,
Facebook Marketplace (paid, logged-out, via stablesocial).

**Verification caveat:** sandboxed coding-agent containers cannot reach most of these hosts
(egress-allowlisted proxy answers CONNECT with 403). Numbers below marked *unverified* came
from search snippets, not direct page reads. Run `node scripts/check-sources.mjs` from a
machine with open egress before trusting or changing any adapter.

## Legal framing (drives everything below)

- **Logged-out scraping of public pages: LOW-MED risk.** *Meta v. Bright Data* (N.D. Cal.
  2024): Meta's ToS do not bar logged-off scraping of public data; Meta dropped the suit.
  This covers public FB groups and public Instagram accounts.
- **Logged-in scraping of private groups: HIGH risk.** *Facebook v. Power Ventures* (9th
  Cir.): ToS violation alone isn't CFAA, but continuing past a block/C&D on
  password-protected data is. Guaranteed account bans. **Keep company-run bots out of
  private groups.** User-consented alternatives (email digests) are materially safer.

## Ranked build order

### 1. Craigslist sublets section — DONE (this branch)
`searchCraigslist` now fetches `cat=sub` ("sublets & temporary") alongside `cat=apa` when
the query carries sublet intent, deduped by post id. Zero cost, existing parser.
Watch-outs: Craigslist blocklists datacenter/VPN IP ranges (2026 reports are consistent);
if the deployed app's scrapes start 403ing, budget $5-20/mo for a small residential proxy
pool. Research also surfaced `newyork.craigslist.org/search/sub` (+ borough paths
`search/mnh/sub` etc.) as Google-indexed live, which conflicts with this repo's earlier
empirical finding that the `newyork.` host 403s — `check-sources.mjs` probes the
`www.craigslist.org/search/area/newyork?cat=` pattern we verified; if it degrades, try the
`newyork.` host next.

### 2. Public "Gypsy Housing" Facebook groups (logged-out scraping)
The Gypsy Housing brand fragmented; the original is now **Ghostlight Housing**
(facebook.com/groups/gypsyhousing) and is **gated** (join-screening — likely the
highest-signal group). But at least three variants are indexed as **public** groups:
- Gypsy Housing® — facebook.com/groups/gypsyhousingny
- The Original Gypsy Housing — facebook.com/groups/1438152599794284
- Gypsy Housing & Apartments NYC — facebook.com/groups/296711348386206
- Unknown visibility: NYC Sublets & Apartments (groups/nycsublets), Gypsy Housing NYC
  (groups/3827629097251324), Gypsy Housing NYC Roommates (groups/GypsyHousingBrooklyn)

Public groups are scrapeable logged-out (the safe legal bucket):
- **Apify** `apify/facebook-groups-scraper` — public groups, no login, ~$2.60/1k posts
- **Bright Data** Facebook Groups scraper — ~$0.75-1.00/1k records, 5k/mo free tier
- **Facebook Graph API is dead** for this: Groups API removed entirely April 2024.

**Precondition:** ~10 min of manual logged-in recon to confirm which groups are actually
public/active and their real sizes — member counts were *unverified* from the sandbox.
Ideally the ingestion runs through stablesocial (same payment rails as Marketplace) if they
add a groups endpoint; otherwise a direct Apify/Bright Data integration with an API key.

### 3. SpareRoom NYC adapter
Largest **verified** uncovered inventory: 4,369 rooms / 2,397 share-and-sublet ads in NYC
(spareroom.com/rooms-for-rent/nyc). No public API; working off-the-shelf Apify scrapers
exist and anti-bot posture is weak. Legal MED — same garden-variety ToS tier as our
Craigslist/Listings Project scraping. Skews rooms/shares rather than whole-apartment
sublets; tag accordingly in results.

### 4. Instagram sublet accounts (Ohana network) — scrape AND partner
The dominant IG player is **Ohana** (liveohana.ai), which runs a network of sublet
communities with vetting/escrow (~33k listings in its first two years, *unverified*):
- Girls Who Sublet (~50k followers), @nyc.sublets (~17k), @nycsubletting (~13k),
  @nyusubletting (~12k), @bookthatsubletnyc (~11k, performing-arts)
- @listingsproject (~18k) adds nothing — we already ingest their site.

Access: Instagram Graph API cannot read accounts we don't own (2026 reality). Logged-out
scraping via Apify `instagram-scraper` (~$1-1.50/1k posts) is LOW-MED legal risk. **The
real cost is parsing:** listings are posted as image screenshots/flyers with details split
between image and caption, so an OCR/vision-model step is required, and many posts are
"DM to connect" with no contact info. Data quality per post is well below StreetEasy/CL.
**In parallel, email Ohana and pitch a partnership/API** — they're a marketplace startup;
a feed deal could obsolete the scraper entirely.

### 5. Private groups (Ghostlight) — user-consented email digest, not cookies
A member sets the group's notifications to "All Posts" with email delivery and pipes a
dedicated mailbox into an ingester. Zero scraping, user-consented, works on private
groups. *Unverified:* whether notification emails carry full post text in 2026 (guides
say delivery can be lossy/delayed) — needs a 1-day spike. If emails are too lossy, the
fallback is per-user consented cookie automation with explicit disclosure, accepting HIGH
legal/ban risk and flaky ops (cookie expiry, checkpoints). Never company-owned bot
accounts inside private groups.

### Quick wins alongside
- **Leasebreak.com** — alive, NYC-only, exactly our use case (sublets/leasebreaks/shares).
  No API, but their free weekly "Leasebreak List" email is a zero-risk feed to parse;
  site itself looks server-rendered/low anti-bot (*unverified*).
- **Furnished Finder** — modest NYC inventory (~125 Manhattan units, travel-nurse skew,
  30+ day stays), working Apify actors, and an official API-partnership program.

## Deprioritized (and why)
- **Kopa** — shut down; records deleted.
- **Flip (flip.lease)** — pivoted to Caretaker (rental-management SaaS) in 2023; no marketplace.
- **Sublet.com** — alive but 1-2★ reputation, paywalled messaging, ghost listings. Liability.
- **Zumper/PadMapper, RentHop** — big but standard 12-month rentals; heavy anti-bot;
  overlaps StreetEasy for little sublet-specific gain.
- **Reddit (r/NYCapartments)** — 2026 API terms are hostile (manual pre-approval, ~$12k
  commercial minimum, ML-use ban); the gray `.json` endpoint works at hobby scale only.
  Modest inventory, many "looking for" posts. Revisit only if everything above ships.
- **June Homes / Anyplace / Nooklyn** — small or own-managed furnished inventory; Nooklyn
  appears to be winding down (flagship office closed mid-2026; listing freshness unverified).

## Open items needing a logged-in human (~30 min total)
1. Confirm which Gypsy Housing groups are public + real member counts/post velocity.
2. Check r/NYCapartments size and whether r/NYCsublets exists.
3. Leasebreak listing volume; subscribe a mailbox to the weekly email.
4. Spike: does a FB group "All Posts" email notification include full post text?
5. Send the Ohana and Leasebreak partnership emails.
