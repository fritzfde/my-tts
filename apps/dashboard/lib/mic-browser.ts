export type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function computeInputLevel(input: Float32Array) {
  if (!input?.length) return 0;
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    sum += input[index] * input[index];
  }
  return Math.sqrt(sum / input.length);
}

export function downsampleToPcm16(input: Float32Array, inSampleRate: number, outSampleRate = 16000) {
  if (!input || !input.length) return new ArrayBuffer(0);

  if (inSampleRate === outSampleRate) {
    const out = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out.buffer;
  }

  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outLength);
  let inOffset = 0;

  for (let index = 0; index < outLength; index += 1) {
    const nextOffset = Math.min(input.length, Math.round((index + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let inner = inOffset; inner < nextOffset; inner += 1) {
      accum += input[inner];
      count += 1;
    }
    const sample = count ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    inOffset = nextOffset;
  }

  return out.buffer;
}

export function concatArrayBuffers(buffers: ArrayBuffer[]) {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  buffers.forEach((buffer) => {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return merged.buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function pcm16ToWavDataUrl(pcmBuffer: ArrayBuffer, sampleRate = 16000) {
  const pcmBytes = new Uint8Array(pcmBuffer);
  const wavBuffer = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(wavBuffer);
  const bytes = new Uint8Array(wavBuffer);

  function writeAscii(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  }

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);
  bytes.set(pcmBytes, 44);

  return `data:audio/wav;base64,${arrayBufferToBase64(wavBuffer)}`;
}

export async function recordEnrollmentSample(durationMs = 5500) {
  const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
    throw new Error('Microphone capture is not supported in this browser');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const audioContext = new AudioContextCtor();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const sinkNode = audioContext.createGain();
  sinkNode.gain.value = 0;
  const processorNode = audioContext.createScriptProcessor(2048, 1, 1);
  const collected: ArrayBuffer[] = [];

  processorNode.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcm = downsampleToPcm16(input, audioContext.sampleRate, 16000);
    if (pcm.byteLength > 0) {
      collected.push(pcm.slice(0));
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(sinkNode);
  sinkNode.connect(audioContext.destination);

  await new Promise((resolve) => setTimeout(resolve, durationMs));

  try {
    processorNode.disconnect();
    sourceNode.disconnect();
    sinkNode.disconnect();
  } catch {}
  processorNode.onaudioprocess = null;
  stream.getTracks().forEach((track) => track.stop());
  await audioContext.close();

  return concatArrayBuffers(collected);
}
