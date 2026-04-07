
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * POTENCIALIZADO: Concatenación con Crossfade Seamless
 * Fundido cruzado de 40ms para evitar clics y asegurar fluidez humana.
 */
export function concatenateAudioBuffers(buffers: AudioBuffer[], ctx: AudioContext): AudioBuffer {
  if (buffers.length === 0) return ctx.createBuffer(1, 1, ctx.sampleRate);
  
  const fadeDuration = 0.04; 
  const fadeSamples = Math.floor(fadeDuration * ctx.sampleRate);
  
  let totalLength = buffers[0].length;
  for (let i = 1; i < buffers.length; i++) {
    totalLength += (buffers[i].length - fadeSamples);
  }
  
  const result = ctx.createBuffer(buffers[0].numberOfChannels, totalLength, ctx.sampleRate);
  
  for (let channel = 0; channel < buffers[0].numberOfChannels; channel++) {
    const channelData = result.getChannelData(channel);
    let offset = 0;
    
    for (let i = 0; i < buffers.length; i++) {
      const currentBuffer = buffers[i].getChannelData(channel);
      
      if (i === 0) {
        channelData.set(currentBuffer, 0);
        offset = currentBuffer.length;
      } else {
        const startOffset = offset - fadeSamples;
        for (let j = 0; j < fadeSamples; j++) {
          const fadeOutFactor = 1 - (j / fadeSamples);
          const fadeInFactor = j / fadeSamples;
          channelData[startOffset + j] = (channelData[startOffset + j] * fadeOutFactor) + (currentBuffer[j] * fadeInFactor);
        }
        channelData.set(currentBuffer.subarray(fadeSamples), offset);
        offset += (currentBuffer.length - fadeSamples);
      }
    }
  }
  return result;
}

export async function decodePcmData(
  data: Uint8Array,
  ctx: AudioContext,
  sourceSampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  if (data.byteLength < 2) {
    return ctx.createBuffer(numChannels, 1, sourceSampleRate);
  }
  const safeLength = Math.floor(data.byteLength / 2) * 2;
  const dataView = new DataView(data.buffer, data.byteOffset, safeLength);
  const frameCount = safeLength / (2 * numChannels);
  
  const sourceBuffer = ctx.createBuffer(numChannels, frameCount, sourceSampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = sourceBuffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      const sample = dataView.getInt16(i * 2 * numChannels + channel * 2, true);
      channelData[i] = sample / 32768.0;
    }
  }

  const targetRate = ctx.sampleRate || 48000;
  const offlineCtx = new OfflineAudioContext(
    numChannels,
    Math.ceil(frameCount * (targetRate / sourceSampleRate)),
    targetRate
  );
  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = sourceBuffer;
  sourceNode.connect(offlineCtx.destination);
  sourceNode.start(0);
  return await offlineCtx.startRendering();
}

export async function robustDecodeAudio(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  return decodePcmData(data, ctx, 24000, 1);
}

export function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  return {
    data: encodeBase64(bytes),
    mimeType: 'audio/pcm;rate=16000',
  };
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);
  
  const offset = 44;
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }
  
  let index = 0;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset + index, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      index += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
