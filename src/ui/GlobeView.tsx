import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import * as THREE from 'three';
import type { CountryFeature, DataPack } from '../game/data';
import { CORRECT_COLOR, NEUTRAL_COLOR, REVEALED_COLOR, heatColor } from '../game/color';

interface Props {
  data: DataPack;
  /** country id -> distance from target, km. */
  guessed: Map<string, number>;
  revealedId: string | null;
  focusId: string | null;
}

const BASE_ALTITUDE = 0.006;
const MARKED_ALTITUDE = 0.016;

export function GlobeView({ data, guessed, revealedId, focusId }: Props) {
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * The globe layer builds one mesh per datum, and 239 of them costs roughly
   * 239x the draw calls for a map that never changes. So the entire world is a
   * single static feature, and only the countries the player has marked get
   * their own mesh, floating just above it.
   */
  const polygons = useMemo(() => {
    const marked = new Set(guessed.keys());
    if (revealedId) marked.add(revealedId);
    return [data.baseFeature, ...data.features.filter((f) => marked.has(f.properties.id))];
  }, [data, guessed, revealedId]);

  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({
    color: '#0a1120', emissive: '#04080f', shininess: 4,
  }), []);

  // The ref is not populated until after the Globe mounts, so setting the camera
  // in a mount effect silently does nothing. onGlobeReady is the reliable hook.
  const handleReady = useCallback(() => {
    const g = globe.current;
    if (!g) return;
    g.controls().enableDamping = true;
    g.controls().minDistance = 130;
    g.pointOfView({ lat: 20, lng: 0, altitude: 2.4 }, 0);
  }, []);

  useEffect(() => {
    if (!focusId || !globe.current) return;
    const c = data.byId.get(focusId);
    if (c) globe.current.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.9 }, 900);
  }, [focusId, data]);

  const idOf = (f: object) => (f as CountryFeature).properties.id;

  const capColor = useCallback((f: object) => {
    const id = idOf(f);
    if (id === '__base') return NEUTRAL_COLOR;
    if (id === revealedId) return REVEALED_COLOR;
    const d = guessed.get(id);
    if (d === undefined) return NEUTRAL_COLOR;
    return d === 0 ? CORRECT_COLOR : heatColor(d, data.maxDistanceKm);
  }, [guessed, revealedId, data.maxDistanceKm]);

  const altitude = useCallback(
    (f: object) => (idOf(f) === '__base' ? BASE_ALTITUDE : MARKED_ALTITUDE), []);

  const strokeColor = useCallback(
    (f: object) => (idOf(f) === '__base' ? '#65769b' : '#ffffff'), []);

  return (
    <div className="globe-wrap" ref={wrap}>
      {size.w > 0 && (
        <Globe
          ref={globe as never}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          onGlobeReady={handleReady}
          globeMaterial={globeMaterial}
          atmosphereColor="#5b8ec4"
          atmosphereAltitude={0.16}
          polygonsData={polygons}
          polygonCapColor={capColor}
          polygonSideColor={() => '#0b1120'}
          polygonStrokeColor={strokeColor}
          polygonAltitude={altitude}
          polygonsTransitionDuration={0}
          onPolygonHover={(f: object | null) => {
            const id = f ? idOf(f) : null;
            setHover(id && id !== '__base' ? id : null);
          }}
        />
      )}
      {/* The globe is read-only: guesses are typed. It only ever names countries
          already on the board, so neither hovering nor clicking can leak an answer. */}
      {hover && <div className="globe-tooltip">{data.byId.get(hover)?.name}</div>}
    </div>
  );
}
