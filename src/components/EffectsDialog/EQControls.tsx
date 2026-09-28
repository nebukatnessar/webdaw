import { useState, useEffect } from 'react';
import type { EQSettings } from '../../types/daw';

import { useTrackStore } from '../../store/trackStore';
import { getDefaultEQSettings } from '../../audio/eq';

interface EQControlsProps {
  trackId: string;
}

type NumericEQKey = Exclude<keyof EQSettings, 'enabled'>;

const EQ_PARAMS = {
  lowGain: { min: -20, max: 20, step: 0.1, label: 'Low Gain (dB)' },
  midGain: { min: -20, max: 20, step: 0.1, label: 'Mid Gain (dB)' },
  highGain: { min: -20, max: 20, step: 0.1, label: 'High Gain (dB)' },
  lowFreq: { min: 20, max: 2000, step: 10, label: 'Low Freq (Hz)' },
  midFreq: { min: 200, max: 8000, step: 10, label: 'Mid Freq (Hz)' },
  highFreq: { min: 1000, max: 20000, step: 10, label: 'High Freq (Hz)' },
  lowQ: { min: 0.1, max: 5, step: 0.1, label: 'Low Q' },
  midQ: { min: 0.1, max: 5, step: 0.1, label: 'Mid Q' },
  highQ: { min: 0.1, max: 5, step: 0.1, label: 'High Q' },
} as const;

export default function EQControls({ trackId }: EQControlsProps) {
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) => state.tracks.find((t) => t.id === trackId));

  const [settings, setSettings] = useState<EQSettings>(
    track?.eq || getDefaultEQSettings()
  );

  // Sync with store when track changes
  useEffect(() => {
    if (track?.eq) {
      setSettings(track.eq);
    }
  }, [track?.eq]);

  const handleChange = (param: NumericEQKey, value: number) => {
    const newSettings = { ...settings, [param]: value };
    setSettings(newSettings);
    updateTrack(trackId, { eq: newSettings });
  };

  const handleEnabledChange = (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    updateTrack(trackId, { eq: newSettings });
  };

  return (
    <div style={{ padding: '10px', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Equalizer</h3>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '12px' }}>Low Band</h4>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Gain (dB)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.lowGain.min}
              max={EQ_PARAMS.lowGain.max}
              step={EQ_PARAMS.lowGain.step}
              value={settings.lowGain}
              onChange={(e) => handleChange('lowGain', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.lowGain.toFixed(1)}
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Frequency (Hz)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.lowFreq.min}
              max={EQ_PARAMS.lowFreq.max}
              step={EQ_PARAMS.lowFreq.step}
              value={settings.lowFreq}
              onChange={(e) => handleChange('lowFreq', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {Math.round(settings.lowFreq)}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Q
            </label>
            <input
              type="range"
              min={EQ_PARAMS.lowQ.min}
              max={EQ_PARAMS.lowQ.max}
              step={EQ_PARAMS.lowQ.step}
              value={settings.lowQ}
              onChange={(e) => handleChange('lowQ', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.lowQ.toFixed(1)}
            </span>
          </div>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '12px' }}>Mid Band</h4>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Gain (dB)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.midGain.min}
              max={EQ_PARAMS.midGain.max}
              step={EQ_PARAMS.midGain.step}
              value={settings.midGain}
              onChange={(e) => handleChange('midGain', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.midGain.toFixed(1)}
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Frequency (Hz)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.midFreq.min}
              max={EQ_PARAMS.midFreq.max}
              step={EQ_PARAMS.midFreq.step}
              value={settings.midFreq}
              onChange={(e) => handleChange('midFreq', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {Math.round(settings.midFreq)}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Q
            </label>
            <input
              type="range"
              min={EQ_PARAMS.midQ.min}
              max={EQ_PARAMS.midQ.max}
              step={EQ_PARAMS.midQ.step}
              value={settings.midQ}
              onChange={(e) => handleChange('midQ', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.midQ.toFixed(1)}
            </span>
          </div>
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '12px' }}>High Band</h4>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Gain (dB)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.highGain.min}
              max={EQ_PARAMS.highGain.max}
              step={EQ_PARAMS.highGain.step}
              value={settings.highGain}
              onChange={(e) => handleChange('highGain', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.highGain.toFixed(1)}
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Frequency (Hz)
            </label>
            <input
              type="range"
              min={EQ_PARAMS.highFreq.min}
              max={EQ_PARAMS.highFreq.max}
              step={EQ_PARAMS.highFreq.step}
              value={settings.highFreq}
              onChange={(e) => handleChange('highFreq', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {Math.round(settings.highFreq)}
            </span>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              Q
            </label>
            <input
              type="range"
              min={EQ_PARAMS.highQ.min}
              max={EQ_PARAMS.highQ.max}
              step={EQ_PARAMS.highQ.step}
              value={settings.highQ}
              onChange={(e) => handleChange('highQ', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.highQ.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
