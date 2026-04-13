import { getLegacyApiBaseUrl } from '@/lib/api/config';

export async function listClonedVoices() {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/voice-clone/voices`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load cloned voices (${response.status})`);
  }

  const data = (await response.json()) as { voices?: string[] };
  return Array.isArray(data.voices)
    ? data.voices.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

export async function synthesizeClonedVoicePreview({
  voiceName,
  text,
  language
}: {
  voiceName: string;
  text: string;
  language: string;
}) {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/voice-clone/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      voice: voiceName,
      text,
      language
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to preview cloned voice (${response.status})`);
  }

  return response.blob();
}

