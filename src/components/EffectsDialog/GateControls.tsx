import { useState, useEffect } from 'react';
import type { EffectsTarget, GateSettings } from '../../types/daw';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import { getDefaultGateSettings } from '../../audio/gate';

interface GateControlsProps {
  trackId?: string;
  target?: EffectsTarget;
}

type NumericGateKey = Exclude<keyof GateSettings, 'enabled'>;

const GATE_PARAMS = {
  threshold: { min: -60, max: 0, step: 1, label: 'Threshold (dB)' },
  attack: { min: 0.001, max: 1, step: 0.001, label: 'Attack (s)' },
  hold: { min: 0, max: 1, step: 0.01, label: 'Hold (s)' },
  release: { min: 0.001, max: 1, step: 0.001, label: 'Release (s)' },
  range: { min: -60, max: 0, step: 1, label: 'Range (dB)' },
} as const;

export default function GateControls({ trackId, target }: GateControlsProps) {
  const resolvedTarget: EffectsTarget = target ?? { kind: 'track', trackId: trackId ?? '' };
  const targetTrackId = resolvedTarget.kind === 'track' ? resolvedTarget.trackId : null;
  const isMaster = resolvedTarget.kind === 'master';
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) =>
    targetTrackId !== null ? state.tracks.find((t) => t.id === targetTrackId) : undefined
  );
  const setMasterEffect = useTransportStore((state) => state.setMasterEffect);
  const masterGate = useTransportStore((state) => (isMaster ? state.masterEffects.gate : undefined));

  const storedSettings = isMaster ? masterGate : track?.gate;

  const [settings, setSettings] = useState<GateSettings>(
    storedSettings || getDefaultGateSettings()
  );

  // Sync with store when settings change
  useEffect(() => {
    if (storedSettings) {
      setSettings(storedSettings);
    }
  }, [storedSettings]);

  const writeSettings = (newSettings: GateSettings) => {
    if (targetTrackId !== null) {
      updateTrack(targetTrackId, { gate: newSettings });
    } else {
      setMasterEffect('gate', newSettings);
    }
  };

  const handleChange = (param: NumericGateKey, value: number) => {
    const newSettings = { ...settings, [param]: value };
    setSettings(newSettings);
    writeSettings(newSettings);
  };

  const handleEnabledChange = (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    writeSettings(newSettings);
  };

  return (
    <div style={{ padding: '10px', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Gate</h3>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => handleEnabledChange(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      {Object.entries(GATE_PARAMS).map(([param, config]) => (
        <div key={param} style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            {config.label}
          </label>
          <input
            type="range"
            min={config.min}
            max={config.max}
            step={config.step}
            value={settings[param as NumericGateKey]}
            onChange={(e) => handleChange(param as NumericGateKey, Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '11px', color: '#888' }}>
            {settings[param as NumericGateKey]}
          </span>
        </div>
      ))}
    </div>
  );
}
