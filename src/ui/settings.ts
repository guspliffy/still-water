import { tuning } from '../tuning';

/**
 * The few choices a player gets (Jonny, 2026-10-22: good defaults, only the basics). Everything
 * else stays in tuning.json. Saved per device.
 */
export interface Settings {
  sound: boolean;
  vibration: boolean;
  /** Gold match pulse and meeting band while aiming (GDD §4.1). */
  timingHelp: boolean;
}

const KEY = 'still-water-settings-v1';
export const DEFAULT_SETTINGS: Settings = { sound: true, vibration: true, timingHelp: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); the choice lasts for this visit.
  }
}

/** Push the choices into live tuning; sound is applied by the caller through Audio. */
export function applySettings(s: Settings): void {
  tuning.feel.haptics = s.vibration;
  tuning.assist.goldMatchPreview = s.timingHelp;
}

export const canVibrate = () => 'vibrate' in navigator;

export function settingsHtml(s: Settings, opts: { fullScreen: boolean; map: boolean }): string {
  const row = (key: keyof Settings, label: string, note: string) =>
    `<div class="set-row"><div>${label}<small>${note}</small></div><button class="toggle ${s[key] ? 'on' : ''}" data-act="${key}" aria-pressed="${s[key]}">${s[key] ? 'On' : 'Off'}</button></div>`;
  return `<h2>Settings</h2>
    <div class="settings">
      ${row('sound', 'Sound', 'Music and lantern chimes')}
      ${canVibrate() ? row('vibration', 'Vibration', 'A light tap on each stone') : ''}
      ${row('timingHelp', 'Timing help', 'A gold lantern pulses when a stone dropped now would light it')}
      ${opts.fullScreen ? `<div class="set-row"><div>Full screen<small>Also with the F key</small></div><button class="toggle" data-act="full">Open</button></div>` : ''}
    </div>
    <div class="row"><button class="primary" data-act="done">Done</button></div>
    <div class="quiet-row">
      <button class="quiet" data-act="howto">How to play</button>
      ${opts.map ? '<button class="quiet" data-act="map">Level map</button>' : ''}
      <button class="quiet" data-act="lessons">Replay lessons</button>
      <button class="quiet" data-act="tune">Developer tuning</button>
    </div>`;
}
