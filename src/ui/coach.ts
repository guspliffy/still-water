import type { SimEvent } from '../sim/sim';
import type { PondDef, Vec } from '../sim/types';

/** Icons drawn to match the in-game shapes, for cards and the how-to-play sheet. */
export const ICONS = {
  plain: `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="11" fill="#ffcf87"/><circle cx="20" cy="20" r="5" fill="#fff" opacity=".7"/></svg>`,
  echo: `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" fill="none" stroke="#5fd4ff" stroke-width="1.2" opacity=".5"/><path d="M20 7 31.3 13.5V26.5L20 33 8.7 26.5V13.5Z" fill="#7fe0ff"/><path d="M20 14.5 24.8 17.3V22.7L20 25.5 15.2 22.7V17.3Z" fill="#fff" opacity=".75"/></svg>`,
  gold: `<svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 4 36 20 20 36 4 20Z" fill="#ffc23d"/><path d="M20 13 27 20 20 27 13 20Z" fill="#fff4d0"/></svg>`,
  rock: `<svg viewBox="0 0 40 40" width="40" height="40"><path d="M9 14 18 7 30 10 34 21 28 32 14 33 6 24Z" fill="#2a3346" stroke="#56637d" stroke-width="2"/></svg>`,
  moon: `<svg viewBox="0 0 40 40" width="40" height="40"><path d="M25 6a14 14 0 1 0 9 22A11 11 0 0 1 25 6Z" fill="#dcdcff"/><circle cx="31" cy="11" r="1.6" fill="#7fe0ff"/></svg>`,
  ring: `<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="15" fill="none" stroke="#ffe2b0" stroke-width="2.5"/><circle cx="20" cy="20" r="9" fill="none" stroke="#ffe2b0" stroke-width="1" opacity=".4"/></svg>`,
};

export interface IntroCard {
  icon: string;
  title: string;
  body: string;
}

/** A card shown before a pond that introduces something new. GDD §7.1. */
export const POND_CARDS: Record<string, IntroCard> = {
  t3: { icon: ICONS.gold, title: 'Gold lantern', body: 'Needs two ripples touching it at the same moment.' },
  t4: { icon: ICONS.echo, title: 'Echo lantern', body: 'When it lights, it sends out a ripple of its own.' },
  t5: { icon: ICONS.rock, title: 'Rock', body: 'Ripples can’t pass through. Lanterns behind it stay dark.' },
  t6: { icon: `${ICONS.moon}${ICONS.echo}`, title: 'Moon lantern', body: 'Sleeps through stone ripples. Only an echo’s ripple wakes it.' },
};

export interface CoachView {
  say: (text: string) => void;
  point: (targets: Vec[]) => void;
}

/**
 * Teaches the opening ponds by doing: one short instruction at a time, a pulsing marker where to
 * tap, and lines that react to what the player just did. GDD §7.1.
 */
export class Coach {
  private pond: PondDef | null = null;
  private drops = 0;
  private generatedIntroSeen = false;

  constructor(
    private readonly v: CoachView,
    private readonly touch: boolean,
  ) {}

  /** firstTry is false on a retry: by then a perfect solve is gone, so the par line stays quiet. */
  start(pond: PondDef, index: number, tutorialLength: number, firstTry = true): void {
    this.pond = pond;
    this.drops = 0;
    const h = pond.hints;
    switch (pond.id) {
      case 't1':
        this.v.say('Tap the water below the lantern');
        this.v.point([pond.solution[0]]);
        return;
      case 't2':
        this.v.say(this.touch ? 'Hold your finger on the lily pad to see how far a ripple reaches, then let go' : 'Point at the lily pad: the dashed circle shows how far a ripple reaches. Click to drop.');
        this.v.point(h);
        return;
      case 't3':
        this.v.say('Tap both lily pads, one right after the other');
        this.v.point(h);
        return;
      case 't4':
        this.v.say('Drop one stone on the lily pad and watch');
        this.v.point(h);
        return;
      case 't6':
        this.v.say('Drop on the lily pad, then watch the moon');
        this.v.point(h);
        return;
      case 't5':
        if (h.length) {
          this.v.say('Here is one way: tap both lily pads together, then let the echo do the rest.');
          this.v.point(h);
        } else {
          this.v.say('No lily pads now. Light all 6 lanterns. Gold still needs two ripples at once.');
          this.v.point([]);
        }
        return;
      default: {
        // The goal before the first throw, so par isn't hidden in the stone counter.
        const perfect = firstTry ? `Perfect: ${pond.par} stone${pond.par > 1 ? 's' : ''} ★★★` : '';
        if (index === tutorialLength && !this.generatedIntroSeen) {
          this.generatedIntroSeen = true;
          this.v.say(`New ponds from here. ${perfect}`);
        } else this.v.say(perfect);
        this.v.point([]);
      }
    }
  }

  onDrop(p: Vec): void {
    const pond = this.pond;
    if (!pond) return;
    this.drops++;
    switch (pond.id) {
      case 't1':
        this.v.say('Watch the ripple spread…');
        this.v.point([]);
        return;
      case 't2':
        this.v.point([]);
        return;
      case 't3': {
        if (this.drops === 1) {
          const other = pond.hints.reduce((a, b) => (dist2(a, p) > dist2(b, p) ? a : b));
          this.v.say('Now the other one, quickly!');
          this.v.point([other]);
        } else this.v.point([]);
        return;
      }
      case 't4':
        this.v.say('Each echo lantern lights the next…');
        this.v.point([]);
        return;
      case 't6':
        this.v.say('Your ripple passes the moon by…');
        this.v.point([]);
        return;
      case 't5':
        if (pond.hints.length && this.drops === 1) {
          this.v.point(pond.hints.filter((q) => dist2(q, p) > 900));
          return;
        }
        this.v.point([]);
        return;
      default:
        if (this.drops === 1) this.v.say('');
    }
  }

  onEvent(e: SimEvent): void {
    const pond = this.pond;
    if (!pond) return;
    if (e.type === 'complete') {
      const done: Record<string, string> = {
        t1: 'Lit! Light every lantern to clear a pond.',
        t2: 'One stone, two lanterns. Fewer stones means more stars.',
        t3: 'The rings met. Gold!',
        t4: 'One stone, five lanterns.',
        t5: '',
        t6: 'Only the echo’s ripple woke it.',
      };
      this.v.say(done[pond.id] ?? '');
      return;
    }
    if (pond.id === 't3' && e.type === 'goldMiss') {
      this.v.say('The rings missed each other. Tap both pads faster, almost together.');
      this.v.point(pond.hints);
      this.drops = 0;
    }
  }

  /** Called when a teaching pond runs out of stones before it was solved. */
  onRetry(): void {
    if (this.pond?.id.startsWith('t')) this.v.say('Out of stones. The pond resets, try again.');
  }
}

function dist2(a: Vec, b: Vec): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
