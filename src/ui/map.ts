import { isLesson, levelOf, totalStars, type Progress } from '../progress';
import { LEVEL_NAMES, OPEN_WATER, TUTORIAL } from '../sim/levels';

/** Map height in a 300-wide box: rows of three stops, 100 apart, plus room for lessons and open water. */
const mapHeight = (levelCount: number) => 100 + Math.ceil(levelCount / 3) * 100;

/** Stop positions: lessons at the bottom, rows of three winding upward, open water on top. */
function stopPoints(levelCount: number): { x: number; y: number }[] {
  const H = mapHeight(levelCount);
  const pts = [{ x: 60, y: H - 32 }];
  for (let k = 0; k < levelCount; k++) {
    const row = Math.floor(k / 3);
    const xs = row % 2 === 0 ? [60, 150, 240] : [240, 150, 60];
    pts.push({ x: xs[k % 3], y: H - 108 - row * 100 });
  }
  pts.push({ x: 60, y: 30 });
  return pts;
}

function pathThrough(pts: { x: number; y: number }[]): string {
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.y === b.y) d += ` L${b.x} ${b.y}`;
    else {
      // Row change: a soft bend that bulges out past the edge stop.
      const bulge = a.x > 150 ? 46 : a.x < 150 ? -46 : 0;
      d += ` C${a.x + bulge} ${a.y} ${b.x + bulge} ${b.y} ${b.x} ${b.y}`;
    }
  }
  return d;
}

/**
 * The level map: lessons, twelve named stops, then open water. Stops up to the furthest reached
 * are buttons (data-act="go<index>"); the rest are quiet and locked.
 */
export function mapHtml(p: Progress, levelCount: number): { html: string; playable: number[] } {
  const T = TUTORIAL.length;
  const pts = stopPoints(levelCount);
  const H = mapHeight(levelCount);
  // Map stop k: 0 = lessons, 1..levelCount = levels, last = open water.
  const indexOf = (k: number) => (k === 0 ? 0 : k <= levelCount ? T + k - 1 : Math.max(p.reached, T + levelCount));
  const reachedStop = isLesson(p.reached) ? 0 : Math.min(levelOf(p.reached) + 1, levelCount + 1);
  const playable: number[] = [];
  const stops = pts
    .map((pt, k) => {
      const index = indexOf(k);
      const open = k <= reachedStop;
      const current = k === reachedStop;
      const level = levelOf(index);
      const stars = k >= 1 && k <= levelCount ? p.best[level]?.stars ?? 0 : 0;
      const name = k === 0 ? 'Lessons' : k <= levelCount ? LEVEL_NAMES[k - 1] : OPEN_WATER;
      const label = k === 0 ? '✓' : k <= levelCount ? String(k) : '∞';
      const cls = ['stop', open ? 'open' : 'locked', current ? 'current' : '', k === 0 && reachedStop > 0 ? 'done' : '', stars ? 'done' : ''].join(' ');
      if (open) playable.push(index);
      const starRow =
        k >= 1 && k <= levelCount && open && !current ? `<i>${[0, 1, 2].map((s) => `<b class="${s < stars ? 'on' : ''}">★</b>`).join('')}</i>` : '';
      const style = `left:${(pt.x / 300) * 100}%;top:${(pt.y / H) * 100}%`;
      const inner = `<span>${k === 0 && reachedStop === 0 ? '·' : label}</span>${starRow}`;
      return open
        ? `<button class="${cls}" style="${style}" data-act="go${index}" title="${name}" aria-label="${name}">${inner}</button>`
        : `<div class="${cls}" style="${style}" aria-hidden="true">${inner}</div>`;
    })
    .join('');
  const litUpTo = pts.slice(0, reachedStop + 1);
  const svg = `<svg viewBox="0 0 300 ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${pathThrough(pts)}" class="trail"/>
    ${litUpTo.length > 1 ? `<path d="${pathThrough(litUpTo)}" class="trail lit"/>` : ''}
  </svg>`;
  const k = reachedStop;
  const nextName = k === 0 ? 'Lessons' : k <= levelCount ? `Level ${k} · ${LEVEL_NAMES[k - 1]}` : OPEN_WATER;
  const html = `<h2>The path</h2><p>Next: <b>${nextName}</b> · <span class="gold">★ ${totalStars(p)} of ${levelCount * 3}</span></p>
    <div class="map-scroll"><div class="map-wrap" style="aspect-ratio:300/${H}">${svg}${stops}</div></div>
    <div class="row"><button class="primary" data-act="continue">Continue</button></div>`;
  return { html, playable };
}
