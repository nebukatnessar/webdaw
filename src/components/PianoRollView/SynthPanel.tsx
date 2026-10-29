import Knob from '../TrackHeaderList/Knob';
import styles from './SynthPanel.module.css';
import { DEFAULT_MONARC_PARAMS, type MonarcParams, type SynthId } from '../../types/daw';
import * as engine from '../../audio/engine';
import { applyMonarcParam } from '../../audio/midiSynth';
import useTrackStore from '../../store/trackStore';

interface Props {
  trackId: string;
  synth: SynthId;
  params: Partial<MonarcParams>;
}

const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const fmtMs = (v: number) => `${Math.round(v * 1000)}ms`;
const fmtCents = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}ct`;
const fmtRatio = (v: number) => `${v}x`;

// Parameter panel for the selected track's synth. For the Monarc bass it
// exposes the webMonarc prototype's full control set (osc levels/waves,
// detune/intervals, sub, resonant lowpass + env amount, amp + filter ADSR,
// glide, drive, master); changes go to the track's live engine immediately
// and are stored on the track so they persist with the project.
export default function SynthPanel({ trackId, synth, params }: Props) {
  const updateTrack = useTrackStore((s) => s.updateTrack);

  if (synth !== 'monarch') {
    return (
      <div className={styles.panel}>
        <div className={styles.hint}>
          {synth === 'base' ? 'Base Saw has no tweakable parameters.' : 'FM Synth parameters coming soon.'}
        </div>
      </div>
    );
  }

  const setParam = (name: keyof MonarcParams, value: number | OscillatorType) => {
    const merged = { ...DEFAULT_MONARC_PARAMS, ...params, [name]: value };
    updateTrack(trackId, { monarcParams: merged });
    const dest = engine.getTrackDestination(trackId);
    if (dest) {
      applyMonarcParam(engine.getAudioContext(), trackId, dest, name, value, merged);
    }
  };

  const p = { ...DEFAULT_MONARC_PARAMS, ...params };
  const waveOptions: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];

  const knob = (
    name: keyof MonarcParams,
    label: string,
    min: number,
    max: number,
    def: number,
    format: (v: number) => string,
  ) => (
    <Knob
      label={label}
      value={p[name] as number}
      min={min}
      max={max}
      defaultValue={def}
      formatValue={format}
      onChange={(v) => setParam(name, v)}
    />
  );

  const waveSelect = (name: keyof MonarcParams, label: string) => (
    <label className={styles.waveField}>
      <span>{label}</span>
      <select
        value={p[name] as OscillatorType}
        onChange={(e) => setParam(name, e.target.value as OscillatorType)}
        aria-label={label}
      >
        {waveOptions.map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
    </label>
  );

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>OSC</div>
        <div className={styles.row}>
          {waveSelect('osc1Wave', 'osc1')}
          {knob('osc1Level', 'osc1 lvl', 0, 1, DEFAULT_MONARC_PARAMS.osc1Level, fmtPct)}
        </div>
        <div className={styles.row}>
          {waveSelect('osc2Wave', 'osc2')}
          {knob('osc2Level', 'osc2 lvl', 0, 1, DEFAULT_MONARC_PARAMS.osc2Level, fmtPct)}
          {knob('osc2Detune', 'detune', -50, 50, DEFAULT_MONARC_PARAMS.osc2Detune, fmtCents)}
          {knob('osc2Ratio', 'interval', 0.25, 4, DEFAULT_MONARC_PARAMS.osc2Ratio, fmtRatio)}
        </div>
        <div className={styles.row}>
          {waveSelect('osc3Wave', 'osc3')}
          {knob('osc3Level', 'osc3 lvl', 0, 1, DEFAULT_MONARC_PARAMS.osc3Level, fmtPct)}
          {knob('osc3Ratio', 'interval', 0.25, 4, DEFAULT_MONARC_PARAMS.osc3Ratio, fmtRatio)}
        </div>
        <div className={styles.row}>
          {waveSelect('subWave', 'sub')}
          {knob('subLevel', 'sub lvl', 0, 1, DEFAULT_MONARC_PARAMS.subLevel, fmtPct)}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>FILTER</div>
        <div className={styles.row}>
          {knob('cutoff', 'cutoff', 40, 12000, DEFAULT_MONARC_PARAMS.cutoff, fmtHz)}
          {knob('resonance', 'reso', 0.1, 20, DEFAULT_MONARC_PARAMS.resonance, (v) => v.toFixed(1))}
          {knob('filterEnv', 'env amt', 0, 8000, DEFAULT_MONARC_PARAMS.filterEnv, fmtHz)}
        </div>
        <div className={styles.row}>
          {knob('filterAttack', 'f.A', 0.001, 1, DEFAULT_MONARC_PARAMS.filterAttack, fmtMs)}
          {knob('filterDecay', 'f.D', 0.02, 2, DEFAULT_MONARC_PARAMS.filterDecay, fmtMs)}
          {knob('filterSustain', 'f.S', 0, 1, DEFAULT_MONARC_PARAMS.filterSustain, fmtPct)}
          {knob('filterRelease', 'f.R', 0.02, 3, DEFAULT_MONARC_PARAMS.filterRelease, fmtMs)}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>AMP</div>
        <div className={styles.row}>
          {knob('ampAttack', 'A', 0.001, 1, DEFAULT_MONARC_PARAMS.ampAttack, fmtMs)}
          {knob('ampDecay', 'D', 0.02, 2, DEFAULT_MONARC_PARAMS.ampDecay, fmtMs)}
          {knob('ampSustain', 'S', 0, 1, DEFAULT_MONARC_PARAMS.ampSustain, fmtPct)}
          {knob('ampRelease', 'R', 0.02, 3, DEFAULT_MONARC_PARAMS.ampRelease, fmtMs)}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>OUT</div>
        <div className={styles.row}>
          {knob('glide', 'glide', 0, 1, DEFAULT_MONARC_PARAMS.glide, fmtMs)}
          {knob('drive', 'drive', 0, 1, DEFAULT_MONARC_PARAMS.drive, fmtPct)}
          {knob('master', 'master', 0, 1, DEFAULT_MONARC_PARAMS.master, fmtPct)}
        </div>
      </div>
    </div>
  );
}
