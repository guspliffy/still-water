import { Pane } from 'tweakpane';
import defaults from '../../config/tuning.json';
import { tuning } from '../tuning';

export interface DevHooks {
  /** A value changed. `section` is the top-level tuning key. */
  onChange: (section: string) => void;
  state: { index: number; tier: number };
  onJump: () => void;
  onShowSolution: () => void;
}

type Obj = Record<string, unknown>;

const RANGES: Record<string, { min: number; max: number; step?: number }> = {
  'ripple.speed': { min: 40, max: 400 },
  'ripple.maxRadius': { min: 80, max: 600 },
  'ripple.echoMaxRadius': { min: 40, max: 400 },
  'ripple.echoDelay': { min: 0, max: 1, step: 0.01 },
  'gold.window': { min: 0.1, max: 1.5, step: 0.01 },
  'feel.sfxVolume': { min: 0, max: 1, step: 0.01 },
  'feel.ambientVolume': { min: 0, max: 1, step: 0.01 },
};

/**
 * Tweakpane panel that binds every value in tuning.json generically, so new keys show up without
 * code changes. Export writes the live values back out as tuning.json.
 */
export function createDevPanel(h: DevHooks): { toggle: () => void } {
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', top: '60px', right: '10px', width: '290px', zIndex: '20', display: 'none' });
  document.body.appendChild(container);
  const pane = new Pane({ container, title: 'Tuning (dev)' });

  const pond = pane.addFolder({ title: 'Pond' });
  pond.addBinding(h.state, 'index', { label: 'pond #', min: 0, max: 200, step: 1 });
  pond.addBinding(h.state, 'tier', { label: 'tier (0 easier, 2 harder)', min: 0, max: 2, step: 1 });
  pond.addButton({ title: 'Go to pond' }).on('click', h.onJump);
  pond.addButton({ title: 'Show solution' }).on('click', h.onShowSolution);

  const bind = (folder: ReturnType<Pane['addFolder']>, obj: Obj, path: string, section: string) => {
    for (const [key, val] of Object.entries(obj)) {
      const full = path ? `${path}.${key}` : key;
      if (typeof val === 'number' || typeof val === 'boolean') {
        const opts = RANGES[full] ?? {};
        folder.addBinding(obj, key, opts).on('change', (ev) => {
          if (ev.last !== false) h.onChange(section);
        });
      } else if (val && typeof val === 'object') {
        bind(folder.addFolder({ title: key, expanded: false }), val as Obj, full, section);
      }
    }
  };
  for (const [section, val] of Object.entries(tuning as unknown as Obj)) {
    bind(pane.addFolder({ title: section, expanded: section === 'ripple' || section === 'gold' || section === 'assist' }), val as Obj, section, section);
  }

  pane.addButton({ title: 'Export tuning.json' }).on('click', () => {
    const blob = new Blob([JSON.stringify(tuning, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tuning.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  pane.addButton({ title: 'Copy JSON' }).on('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2));
  });
  pane.addButton({ title: 'Reset to defaults' }).on('click', () => {
    const fresh = structuredClone(defaults) as unknown as Obj;
    const t = tuning as unknown as Obj;
    for (const k of Object.keys(fresh)) Object.assign(t[k] as Obj, fresh[k] as Obj);
    pane.refresh();
    h.onChange('*');
  });

  // Keep pointer events on the panel from dropping stones.
  container.addEventListener('pointerdown', (e) => e.stopPropagation());
  return {
    toggle: () => {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
      pane.refresh();
    },
  };
}
