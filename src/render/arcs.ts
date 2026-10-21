/** Visible arcs of a full circle after removing the given gaps (radians). */
export function visibleArcs(gaps: [number, number][]): [number, number][] {
  const TAU = Math.PI * 2;
  const norm: [number, number][] = [];
  for (const [a0, a1] of gaps) {
    let s = ((a0 % TAU) + TAU) % TAU;
    let e = s + (a1 - a0);
    if (e > TAU) {
      norm.push([s, TAU], [0, e - TAU]);
    } else norm.push([s, e]);
  }
  norm.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const g of norm) {
    const last = merged[merged.length - 1];
    if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
    else merged.push([...g]);
  }
  const out: [number, number][] = [];
  let cur = 0;
  for (const [s, e] of merged) {
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < TAU) out.push([cur, TAU]);
  return out;
}
