# Globle · custom

A hot/cold country guessing game on a 3D globe, with the two things the original
is missing: **you choose which countries can come up**, and **it learns which
ones you are bad at**.

Everything runs in the browser. No account, no server, no network calls after
the initial load.

## The game

Type a country. Every guess colours in on the globe, warmer the closer it is to
the answer.

The world starts as a plain silhouette with no borders — outlines would give
away the answer's shape. The globe is read-only for the same reason: it only
ever labels countries already on the board, because naming an unguessed one
would turn the map into a lookup table.

**Help me** gives up ground in stages. The first press draws every country's
borders. The second tells you the answer's first letter. **Give up** is there
the whole time, hints or not, and reveals the answer in purple. Hints are
recorded and count against you in the stats — taking one is evidence the country
was hard for you.

There is no autocomplete dropdown. You type a country and press Enter, and one
of three things happens:

- **It is clear** — an exact name or alias (`holland`, `burma`, `uk`, `drc`,
  `ivory coast`) or a prefix only one country has (`switz`, `bosnia`,
  `united arab`) — and the guess is taken.
- **It is close** — `cjina`, `swizerland`, `phillipines`, `untied states` — and
  you are asked: *maybe you meant **China**?* Press Enter again or click the name
  to accept, or keep typing. A tie lists the rivals (`ambia` offers Gambia or
  Zambia) and Enter will not choose between them.
- **It resembles nothing** — *no such country exists*.

A misspelling is never scored against a country you did not confirm, which is
what lets the tolerance be generous rather than cautious: an unwanted suggestion
costs a glance, where an unwanted guess costs a turn. Whatever you actually typed
is what goes into the history, even when you accept a correction.

Distance is the **minimum distance between borders**, not between centroids,
which is what makes the hot/cold signal feel right — Portugal and Spain are
touching, not 500 km apart.

## Customisation

**Which countries.** Pick the whole world, a continent, a UN subregion
(Southeast Asia, Western Africa, the Caribbean, …), or tick any combination of
the 25 subregions. The answer pool is the 193 UN members present in the map
data; territories and disputed areas stay guessable but are never the answer.

**Settings** (a tab on desktop, behind the menu on narrow screens):

- **Track my guesses** — on by default. Recording finished rounds is what makes
  adaptive targeting possible, so the two are one switch rather than two. Turn it
  off and rounds leave no trace, with targets drawn uniformly at random instead;
  history already recorded is kept, not deleted, and clearing it lives under
  Stats.
- **Distance units** — kilometres, miles, or closeness as a percentage.
- **Fly to each guess** — whether the globe rotates to a country when you guess it.

While tracking is on, every country you have played is scored on five signals you
actually generate: how many guesses it took, how far off your opening guesses
were, how long you took, how many hints you took, and whether you gave up. Recent
games count for more than old ones (exponential decay), and a country you have
not seen in weeks gets a lift so the rotation does not collapse onto the same
handful. Countries you have never been given start from a middling prior, so they
enter the rotation without dominating it.

See `src/game/selection.ts` — the weights are all in one place and easy to tune.

## Your data

Every round is stored locally in IndexedDB as a full record:

```ts
{
  id, targetId, startedAt, endedAt,
  outcome: 'solved' | 'gave_up' | 'abandoned',
  scope, strategy, hintsUsed,
  guesses: [{ input, at, countryId, distanceKm }]
}
```

`input` is what you actually typed, `countryId` is what it resolved to, `at` is
when. That is what the adaptive scoring reads, and it is enough to reconstruct
any round later.

The Stats panel exports and imports this as JSON, so you can move history
between browsers. Imports merge by game id rather than overwriting. The save
format is versioned (`SCHEMA_VERSION` in `src/game/storage.ts`) with a migration
chain, so old exports keep working — `npm run check` round-trips a v1 save
through it.

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

Net effect: ~4,800 draw calls a frame becomes ~1,100, and hiding borders by
default removes the stroke line object per country on top of that.

Borders are the extruded side walls between neighbouring countries, not the
stroke. A stroke line sits at cap height, so an inland border is hidden by the
neighbour's cap and only coastlines ever draw — which is why the borders hint
recolours the walls instead of turning strokes on.

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
- Fuzzy matching has to be kept on a leash. `scripts/check-data.ts` asserts that
  no single-character slip in any country's name resolves to a *different*
  country — it is the check that catches an over-eager matcher, and it caught
  two while this was being written.

## Licence

MIT.
