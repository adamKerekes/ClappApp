import { useState } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import type { Series } from '@/lib/obd/session';

/** Normál (optimális tartományon belüli) érték színe. */
export const GOOD_COLOR = '#30A46C';
/** Az optimálistól eltérő érték színe. */
export const BAD_COLOR = '#E5484D';
export const OK_BAND_COLOR = GOOD_COLOR;

export const isGood = (value: number, ok?: [number, number]) => !ok || (value >= ok[0] && value <= ok[1]);

type Props = {
  series: Series;
  /** A függőleges tartomány; ha nincs, az adatokhoz igazodik. */
  range?: [number, number];
  /** Az optimális sáv, halványan jelölve. */
  ok?: [number, number];
  /** Időtartomány (ms, epoch). */
  from: number;
  to: number;
  style?: StyleProp<ViewStyle>;
  /** Halványabb vonal (háttérgrafikonként). */
  subtle?: boolean;
};

/** A ténylegesen kirajzolt függőleges tartomány. */
export function chartRange(series: Series, range?: [number, number]): [number, number] {
  if (range) return range;
  if (series.v.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const value of series.v) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

/**
 * Ritkítás a teljes futás grafikonjához: időszeletenként a legkisebb és a legnagyobb érték
 * marad meg, így a csúcsok nem vesznek el.
 */
function downsample(series: Series, from: number, to: number, buckets: number): Series {
  if (series.t.length <= buckets * 2) return series;
  const out: Series = { t: [], v: [] };
  const span = Math.max(1, to - from);
  let bucket = -1;
  let minI = -1;
  let maxI = -1;
  const flush = () => {
    if (minI < 0) return;
    const [a, b] = minI < maxI ? [minI, maxI] : [maxI, minI];
    out.t.push(series.t[a]);
    out.v.push(series.v[a]);
    if (b !== a) {
      out.t.push(series.t[b]);
      out.v.push(series.v[b]);
    }
  };
  for (let i = 0; i < series.t.length; i++) {
    const b = Math.floor(((series.t[i] - from) / span) * buckets);
    if (b !== bucket) {
      flush();
      bucket = b;
      minI = i;
      maxI = i;
    } else {
      if (series.v[i] < series.v[minI]) minI = i;
      if (series.v[i] > series.v[maxI]) maxI = i;
    }
  }
  flush();
  return out;
}

/** Vonaldiagram, a doboz hátterében vagy a részletes nézetben. */
export function Chart({ series, range, ok, from, to, style, subtle }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;
  const [min, max] = chartRange(series, range);
  const span = Math.max(1, to - from);
  const data = w > 0 ? downsample(series, from, to, Math.round(w / 2)) : series;

  const x = (t: number) => ((t - from) / span) * w;
  const y = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    return h - ((clamped - min) / (max - min)) * h;
  };

  // A vonal szakaszokra bomlik: zöld, ahol az érték normál, piros, ahol eltér az optimálistól.
  // Egy szakasz színét a két végpont közti átlag dönti el.
  type Run = { good: boolean; line: string; area: string };
  const runs: Run[] = [];
  const pt = (i: number) => `${x(data.t[i]).toFixed(1)},${y(data.v[i]).toFixed(1)}`;
  const close = (run: Run, firstX: number, lastX: number) => {
    run.area = `${run.line}L${lastX.toFixed(1)},${h}L${firstX.toFixed(1)},${h}Z`;
  };
  let current: Run | null = null;
  let runStartX = 0;
  for (let i = 1; i < data.t.length; i++) {
    const good = isGood((data.v[i - 1] + data.v[i]) / 2, ok);
    if (!current || current.good !== good) {
      if (current) close(current, runStartX, x(data.t[i - 1]));
      current = { good, line: `M${pt(i - 1)}`, area: '' };
      runs.push(current);
      runStartX = x(data.t[i - 1]);
    }
    current.line += `L${pt(i)}`;
  }
  if (current) close(current, runStartX, x(data.t[data.t.length - 1]));
  // Egyetlen pontnál egy rövid vízszintes vonal.
  if (data.t.length === 1) {
    const p0 = pt(0);
    runs.push({
      good: isGood(data.v[0], ok),
      line: `M${p0}L${(x(data.t[0]) + 2).toFixed(1)},${y(data.v[0]).toFixed(1)}`,
      area: '',
    });
  }

  const okTop = ok ? y(ok[1]) : 0;
  const okBottom = ok ? y(ok[0]) : 0;

  return (
    <View
      style={style}
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && h > 0 && (
        <Svg width={w} height={h}>
          {ok && okBottom > okTop && (
            <Rect x={0} y={okTop} width={w} height={okBottom - okTop} fill={OK_BAND_COLOR} opacity={subtle ? 0.07 : 0.1} />
          )}
          {!subtle && (
            <>
              <Line x1={0} y1={0.5} x2={w} y2={0.5} stroke="#888" strokeOpacity={0.3} strokeWidth={1} />
              <Line x1={0} y1={h - 0.5} x2={w} y2={h - 0.5} stroke="#888" strokeOpacity={0.3} strokeWidth={1} />
            </>
          )}
          {runs.map((run, i) =>
            run.area !== '' ? (
              <Path key={`a${i}`} d={run.area} fill={run.good ? GOOD_COLOR : BAD_COLOR} opacity={subtle ? 0.12 : 0.18} />
            ) : null
          )}
          {runs.map((run, i) => (
            <Path
              key={`l${i}`}
              d={run.line}
              stroke={run.good ? GOOD_COLOR : BAD_COLOR}
              strokeOpacity={subtle ? 0.75 : 1}
              strokeWidth={subtle ? 1.5 : 2}
              fill="none"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
