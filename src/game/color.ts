import type { Units } from './types';

/**
 * Proximity colour ramp.
 *
 * A linear ramp against a 19,800 km maximum makes a guess on the far side of an
 * ocean look encouragingly warm. Raising (1 - d/max) to a power above 1 pushes
 * the warm end into the last few thousand kilometres, where it is actually
 * telling the player something.
 */
const FALLOFF = 2.2;
const STOPS: Array<[number, [number, number, number]]> = [
  [0.00, [0xfa, 0xf0, 0xdc]],
  [0.35, [0xf2, 0xc0, 0x8f]],
  [0.60, [0xe8, 0x84, 0x5a]],
  [0.80, [0xd6, 0x3d, 0x2f]],
  [0.93, [0xa5, 0x0f, 0x1c]],
  [1.00, [0x5c, 0x03, 0x0c]],
];

export const CORRECT_COLOR = '#2f9e63';
export const NEUTRAL_COLOR = '#3c4a68';
export const REVEALED_COLOR = '#7b4bd6';

export function proximity(distanceKm: number, maxKm: number): number {
  const t = Math.min(1, Math.max(0, distanceKm / maxKm));
  return (1 - t) ** FALLOFF;
}

export function heatColor(distanceKm: number, maxKm: number, alpha = 1): string {
  if (distanceKm === 0) return CORRECT_COLOR;
  const p = proximity(distanceKm, maxKm);
  let i = 0;
  while (i < STOPS.length - 2 && p > STOPS[i + 1][0]) i++;
  const [p0, c0] = STOPS[i];
  const [p1, c1] = STOPS[i + 1];
  const f = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
  const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const MILES_PER_KM = 0.621371;

export function formatDistance(km: number, units: Units, maxKm: number): string {
  if (units === 'percent') return `${Math.round(proximity(km, maxKm) * 100)}%`;
  if (km === 0) return 'bordering';
  if (units === 'mi') return `${Math.round(km * MILES_PER_KM).toLocaleString('en-US')} mi`;
  return `${km.toLocaleString('en-US')} km`;
}

export const UNIT_LABELS: Record<Units, string> = {
  km: 'Kilometres',
  mi: 'Miles',
  percent: 'Closeness (%)',
};
