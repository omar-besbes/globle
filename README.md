# Globle · custom

A hot/cold country guessing game on a 3D globe, with the two things the original
is missing: **you choose which countries can come up**, and **it learns which
ones you are bad at**.

Everything runs in the browser. No account, no server, no network calls after
the initial load.

## The game

Guess a country. Every guess colours in on the globe, warmer the closer it is to
the answer. Guess by typing, or by clicking the globe directly. Give up and the
answer is revealed in purple.

Distance is the **minimum distance between borders**, not between centroids,
which is what makes the hot/cold signal feel right — Portugal and Spain are
touching, not 500 km apart.

## Customisation

**Which countries.** Pick the whole world, a continent, a UN subregion
(Southeast Asia, Western Africa, the Caribbean, …), or tick any combination of
the 25 subregions. The answer pool is the 193 UN members present in the map
data; territories and disputed areas stay guessable but are never the answer.

**How targets are chosen.**

- *Random* — uniform over the selected pool.
- *Adaptive* (default) — weighted toward the countries you struggle with.

Adaptive scores every country you have played on four signals you actually
generate: how many guesses it took, how far off your opening guesses were, how
long you took, and whether you gave up. Recent games count for more than old
ones (exponential decay), and a country you have not seen in weeks gets a lift
so the rotation does not collapse onto the same handful. Countries you have
never been given start from a middling prior, so they enter the rotation without
dominating it.

See `src/game/selection.ts` — the weights are all in one place and easy to tune.

## Your data

Every round is stored locally in IndexedDB as a full record:

```ts
{
  id, targetId, startedAt, endedAt,
  outcome: 'solved' | 'gave_up' | 'abandoned',
  scope, strategy,
  guesses: [{ input, at, countryId, distanceKm }]
}
```

`input` is what you actually typed, `countryId` is what it resolved to, `at` is
when. That is what the adaptive scoring reads, and it is enough to reconstruct
any round later.

The Stats panel exports and imports this as JSON, so you can move history
between browsers. Imports merge by game id rather than overwriting. The save
format is versioned (`SCHEMA_VERSION` in `src/game/storage.ts`) with a migration
chain, so old exports keep working.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/globle/
npm run build      # -> dist/
npm run check      # sanity-checks the generated data pack
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to
`main`. The Vite `base` is `/globle/` to match the Pages path; set `BASE_PATH=/`
for a root-hosted deploy.

## How it is built

**Stack.** Vite + React + TypeScript, `react-globe.gl` (three.js) for the globe,
`idb-keyval` for storage. No WebAssembly: with ~240 countries and a precomputed
lookup table there is no runtime geometry maths worth optimising.

**Data pipeline.** `scripts/build-data.ts` runs at build time and emits three
files into `public/data`:

| file | what | size |
| --- | --- | --- |
| `countries.json` | metadata, aliases, canonical ordering | 62 KB |
| `dist.bin` | `Uint16` upper-triangular distance matrix, km | 57 KB |
| `geometry.json` | simplified render geometry | 186 KB |

Geometry is Natural Earth 1:50m via `world-atlas`; country metadata (region,
subregion, land borders, alternate spellings) is `world-countries`, joined on
ISO 3166-1 numeric codes. 1:50m rather than 1:110m because 110m drops 60-odd
small states — at 50m the answer pool covers 193 of the 194 UN members
(Tuvalu is the sole casualty).

Distances are computed once, offline, over the **full-resolution** geometry:
vertices are thinned onto a 15 km grid, clustered, and compared with bounding-cap
pruning so the 28,000 country pairs take about two seconds. Land borders come
from `world-countries` and are pinned to zero.

### Rendering, and why the map is simplified

The globe layer emits a cap mesh, a side wall and a stroke line **per polygon
ring**. The world at 1:50m has ~1,600 rings, which is ~4,800 draw calls a frame
before anything moves. Two things fix that, both at build time:

- Rings are simplified topology-preservingly (shared arcs stay shared, so
  neighbours do not develop gaps) down to 10% of their points.
- Islands too small to see are dropped, keeping each country's largest landmass
  so island nations stay on the map: 1,612 polygon parts become 370.

At runtime the entire world is drawn as **one static feature**, and only the
countries you have marked get their own mesh floating just above it. That takes
a 239-object scene down to roughly `1 + guesses`.

Net effect: ~4,800 draw calls a frame becomes ~1,100.

Because the coastline is simplified, a click on Sydney or Manhattan lands
slightly out to sea, so hit-testing falls back to the nearest coastline within
260 km before calling it open water.

### Things that will bite you if you fork this

- Natural Earth's `ISO_A3` is `-99` for France, Norway, Kosovo, Northern Cyprus
  and Somaliland. This project joins on ISO **numeric** codes instead and patches
  the five unmatched features by name.
- Natural Earth also tags some dependencies with their parent's ISO number —
  Ashmore and Cartier Islands carry Australia's. Those are merged into the
  parent rather than becoming a duplicate country.
- Distances use **all** of a country's territory. France's geometry includes
  French Guiana, so France is 0 km from Brazil. That is honest for "closest
  point of any territory", and it is the single most likely thing you would want
  to change.
- Aliases claimed by more than one country are dropped, unless the alias is one
  country's own name.

## Licence

MIT.
