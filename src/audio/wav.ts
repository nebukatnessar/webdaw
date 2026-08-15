export function encodeWav(buffer: AudioBuffer, sampleRate: number = buffer.sampleRate): Blob {
  const numChannels = buffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * numChannels * bytesPerSample;

  const bufferLength = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const offset = 44;
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    const channelData = buffer.getChannelData(i);
    for (let j = 0; j < channelData.length; j++) {
      const sample = Math.max(-1, Math.min(1, channelData[j]));
      const intSample = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(offset + j * blockAlign + i * bytesPerSample, intSample, true);
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
