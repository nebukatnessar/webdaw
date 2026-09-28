import { useState, useEffect } from 'react';
import type { ReverbSettings, ReverbRoomType } from '../../types/daw';

import { useTrackStore } from '../../store/trackStore';
import { getDefaultReverbSettings } from '../../audio/reverb';

interface ReverbControlsProps {
  trackId: string;
}

const ROOM_TYPES: ReverbRoomType[] = ['Room', 'Hall', 'Cathedral'];

type NumericReverbKey = Exclude<keyof ReverbSettings, 'enabled' | 'roomType'>;

const REVERB_PARAMS = {
  decay: { min: 0.1, max: 2.0, step: 0.1, label: 'Decay' },
  preDelay: { min: 0, max: 500, step: 10, label: 'Pre-Delay (ms)' },
  wet: { min: 0, max: 1, step: 0.01, label: 'Wet' },
  dry: { min: 0, max: 1, step: 0.01, label: 'Dry' },
  damping: { min: 0, max: 1, step: 0.01, label: 'Damping' },
} as const;

export default function ReverbControls({ trackId }: ReverbControlsProps) {
  const updateTrack = useTrackStore((state) => state.updateTrack);
  const track = useTrackStore((state) => state.tracks.find((t) => t.id === trackId));

  const [settings, setSettings] = useState<ReverbSettings>(
    track?.reverb || getDefaultReverbSettings()
  );

  // Sync with store when track changes
  useEffect(() => {
    if (track?.reverb) {
      setSettings(track.reverb);
    }
  }, [track?.reverb]);

  const handleChange = (param: NumericReverbKey, value: number) => {
    const newSettings = { ...settings, [param]: value };
    setSettings(newSettings);
    updateTrack(trackId, { reverb: newSettings });
  };

  const handleRoomTypeChange = (roomType: ReverbRoomType) => {
    const newSettings = { ...settings, roomType };
    setSettings(newSettings);
    updateTrack(trackId, { reverb: newSettings });
  };

  const handleEnabledChange = (enabled: boolean) => {
    const newSettings = { ...settings, enabled };
    setSettings(newSettings);
    updateTrack(trackId, { reverb: newSettings });
  };

  return (
    <div style={{ padding: '10px', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 10px 0' }}>Reverb</h3>

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

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
          Room Type
        </label>
        <select
          value={settings.roomType}
          onChange={(e) => handleRoomTypeChange(e.target.value as ReverbRoomType)}
          style={{ width: '100%', padding: '4px', fontSize: '12px' }}
        >
          {ROOM_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {REVERB_PARAMS.decay.label}
            </label>
            <input
              type="range"
              min={REVERB_PARAMS.decay.min}
              max={REVERB_PARAMS.decay.max}
              step={REVERB_PARAMS.decay.step}
              value={settings.decay}
              onChange={(e) => handleChange('decay', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {settings.decay.toFixed(1)}x
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {REVERB_PARAMS.preDelay.label}
            </label>
            <input
              type="range"
              min={REVERB_PARAMS.preDelay.min}
              max={REVERB_PARAMS.preDelay.max}
              step={REVERB_PARAMS.preDelay.step}
              value={settings.preDelay}
              onChange={(e) => handleChange('preDelay', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {Math.round(settings.preDelay)}ms
            </span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {REVERB_PARAMS.damping.label}
            </label>
            <input
              type="range"
              min={REVERB_PARAMS.damping.min}
              max={REVERB_PARAMS.damping.max}
              step={REVERB_PARAMS.damping.step}
              value={settings.damping}
              onChange={(e) => handleChange('damping', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: '10px', color: '#888' }}>
              {(settings.damping * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px' }}>
              {REVERB_PARAMS.wet.label}
            </label>
            <input
              type="range"
              min={REVERB_PARAMS.wet.min}
              max={REVERB_PARAMS.wet.max}
              step={REVERB_PARAMS.wet.step}
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
              {REVERB_PARAMS.dry.label}
            </label>
            <input
              type="range"
              min={REVERB_PARAMS.dry.min}
              max={REVERB_PARAMS.dry.max}
              step={REVERB_PARAMS.dry.step}
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
