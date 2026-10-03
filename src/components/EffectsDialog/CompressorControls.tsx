import { useState, useEffect } from 'react';
import type { EffectsTarget, CompressorSettings } from '../../types/daw';
import { useTrackStore } from '../../store/trackStore';
import { useTransportStore } from '../../store/transportStore';
import { getDefaultCompressorSettings } from '../../audio/compressor';

interface CompressorControlsProps {
  trackId?: string;
  target?: EffectsTarget;
}

type NumericCompressorKey = Exclude<keyof CompressorSettings, 'enabled'>;

const COMPRESSOR_PARAMS = {
  threshold: { min: -60, max: 0, step: 1, label: 'Threshold (dB)' },
  ratio: { min: 1, max: 20, step: 0.1, label: 'Ratio' },
  attack: { min: 0.001, max: 1, step: 0.001, label: 'Attack (s)' },
  release: { min: 0.001, max: 1, step: 0.001, label: 'Release (s)' },
  knee: { min: 0, max: 40, step: 1, label: 'Knee (dB)' },
  makeupGain: { min: 0, max: 20, step: 1, label: 'Makeup Gain (dB)' },
} as const;

export default function CompressorControls({ trackId, target }: CompressorControlsProps) {
  const resolvedTarget: EffectsTarget = target ?? { kind: 'track', trackId: trackId ?? '' };
  const targetTrackId = resolvedTarget.kind === 'track' ? resolvedTarget.trackId : null;
  const isMaster = resolvedTarget.kind === 'master';
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) =>
    targetTrackId !== null ? state.tracks.find((t) => t.id === targetTrackId) : undefined
  );
  const setMasterEffect = useTransportStore((state) => state.setMasterEffect);
  const masterCompressor = useTransportStore((state) => (isMaster ? state.masterEffects.compressor : undefined));

  const storedSettings = isMaster ? masterCompressor : track?.compressor;
  
  const [settings, setSettings] = useState<CompressorSettings>(
    storedSettings || getDefaultCompressorSettings()
  );

  // Sync with store when settings change
  useEffect(() => {
    if (storedSettings) {
      setSettings(storedSettings);
    }
  }, [storedSettings]);

  const writeSettings = (newSettings: CompressorSettings) => {
    if (targetTrackId !== null) {
      updateTrack(targetTrackId, { compressor: newSettings });
    } else {
      setMasterEffect('compressor', newSettings);
    }
  };

  const handleChange = (param: NumericCompressorKey, value: number) => {
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
      <h3 style={{ margin: '0 0 10px 0' }}>Compressor</h3>
      
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

      {Object.entries(COMPRESSOR_PARAMS).map(([param, config]) => (
        <div key={param} style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
            {config.label}
          </label>
          <input
            type="range"
            min={config.min}
            max={config.max}
            step={config.step}
            value={settings[param as NumericCompressorKey]}
            onChange={(e) => handleChange(param as NumericCompressorKey, Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '11px', color: '#888' }}>
            {settings[param as NumericCompressorKey]}
          </span>
        </div>
      ))}
    </div>
  );
}
