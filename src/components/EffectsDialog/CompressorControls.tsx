import { useState, useEffect } from 'react';
import type { CompressorSettings } from '../../types/daw';
import { useTrackStore } from '../../store/trackStore';
import { getDefaultCompressorSettings } from '../../audio/compressor';

interface CompressorControlsProps {
  trackId: string;
}

const COMPRESSOR_PARAMS = {
  threshold: { min: -60, max: 0, step: 1, label: 'Threshold (dB)' },
  ratio: { min: 1, max: 20, step: 0.1, label: 'Ratio' },
  attack: { min: 0.001, max: 1, step: 0.001, label: 'Attack (s)' },
  release: { min: 0.001, max: 1, step: 0.001, label: 'Release (s)' },
  knee: { min: 0, max: 40, step: 1, label: 'Knee (dB)' },
} as const;

export default function CompressorControls({ trackId }: CompressorControlsProps) {
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) => state.tracks.find((t) => t.id === trackId));
  
  const [settings, setSettings] = useState<CompressorSettings>(
    track?.compressor || getDefaultCompressorSettings()
  );

  // Sync with store when track changes
  useEffect(() => {
    if (track?.compressor) {
      setSettings(track.compressor);
    }
  }, [track?.compressor]);

  const handleChange = (param: keyof CompressorSettings, value: number) => {
    const newSettings = { ...settings, [param]: value };
    setSettings(newSettings);
    updateTrack(trackId, { compressor: newSettings });
  };

  const handleEnabledChange = (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    updateTrack(trackId, { compressor: newSettings });
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
            value={settings[param as keyof CompressorSettings]}
            onChange={(e) => handleChange(param as keyof CompressorSettings, Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '11px', color: '#888' }}>
            {settings[param as keyof CompressorSettings]}
          </span>
        </div>
      ))}
    </div>
  );
}
