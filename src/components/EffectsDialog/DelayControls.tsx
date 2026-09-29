import { useState, useEffect } from 'react';
import type { DelaySettings } from '../../types/daw';

import { useTrackStore } from '../../store/trackStore';
import { getDefaultDelaySettings } from '../../audio/delay';

interface DelayControlsProps {
  trackId: string;
}

type NumericDelayKey = Exclude<keyof DelaySettings, 'enabled'>;

const DELAY_PARAMS = {
  delayTime: { min: 1, max: 2000, step: 1, label: 'Delay Time (ms)' },
  feedback: { min: 0, max: 1, step: 0.01, label: 'Feedback' },
  wet: { min: 0, max: 1, step: 0.01, label: 'Wet' },
  dry: { min: 0, max: 1, step: 0.01, label: 'Dry' },
} as const;

export default function DelayControls({ trackId }: DelayControlsProps) {
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) => state.tracks.find((t) => t.id === trackId));

  const [settings, setSettings] = useState<DelaySettings>(
    track?.delay || getDefaultDelaySettings()
  );

  // Sync with store when track changes
  useEffect(() => {
    if (track?.delay) {
      setSettings(track.delay);
    }
  }, [track?.delay]);

  const handleChange = (param: NumericDelayKey, value: number) => {
    const newSettings = { ...settings, [param]: value };
    setSettings(newSettings);
    updateTrack(trackId, { delay: newSettings });
  };

  const handleEnabledChange = (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    updateTrack(trackId, { delay: newSettings });
  };

  return (
    <div style={{ padding: '10px', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Delay</h3>

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {DELAY_PARAMS.delayTime.label}
            </label>
            <input
              type="range"
              min={DELAY_PARAMS.delayTime.min}
              max={DELAY_PARAMS.delayTime.max}
              step={DELAY_PARAMS.delayTime.step}
              value={settings.delayTime}
              onChange={(e) => handleChange('delayTime', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {Math.round(settings.delayTime)}ms
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {DELAY_PARAMS.feedback.label}
            </label>
            <input
              type="range"
              min={DELAY_PARAMS.feedback.min}
              max={DELAY_PARAMS.feedback.max}
              step={DELAY_PARAMS.feedback.step}
              value={settings.feedback}
              onChange={(e) => handleChange('feedback', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {(settings.feedback * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {DELAY_PARAMS.wet.label}
            </label>
            <input
              type="range"
              min={DELAY_PARAMS.wet.min}
              max={DELAY_PARAMS.wet.max}
              step={DELAY_PARAMS.wet.step}
              value={settings.wet}
              onChange={(e) => handleChange('wet', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {(settings.wet * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {DELAY_PARAMS.dry.label}
            </label>
            <input
              type="range"
              min={DELAY_PARAMS.dry.min}
              max={DELAY_PARAMS.dry.max}
              step={DELAY_PARAMS.dry.step}
              value={settings.dry}
              onChange={(e) => handleChange('dry', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {(settings.dry * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}