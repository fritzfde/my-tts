const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do', 'for', 'from',
  'get', 'got', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'just', 'let', 'lets', 'me', 'my', 'of', 'on', 'or', 'our', 'out', 'so',
  'that', 'the', 'their', 'them', 'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'what', 'when', 'with', 'you', 'your', 'yours',
  'now', 'thank', 'thanks',
  'audio', 'clip', 'custom', 'effect', 'file', 'media', 'mov', 'mp3', 'mp4', 'ogg', 'sound', 'video', 'wav', 'webm'
]);

function stripDiacritics(value) {
  const raw = String(value || '');
  if (typeof raw.normalize !== 'function') return raw;
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitFilenameKeywords(value) {
  const base = path.basename(String(value || ''), path.extname(String(value || '')));
  return normalizeText(base)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function dedupeKeywords(values = []) {
  const next = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (next.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) return;
    next.push(normalized);
  });
  return next;
}

function extractKeywordsFromFilename(value, maxKeywords = 8) {
  return dedupeKeywords(splitFilenameKeywords(value)).slice(0, maxKeywords);
}

function rankTextKeywords(tokens = [], rawText = '') {
  const wordCounts = new Map();
  const phraseCounts = new Map();
  const originalTokens = tokens.filter(Boolean);

  originalTokens.forEach((token) => {
    if (token.length < 2 || STOPWORDS.has(token)) return;
    wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
  });

  const sentenceGroups = String(rawText || '')
    .split(/[.!?]+/)
    .map((chunk) => normalizeText(chunk))
    .filter(Boolean)
    .map((chunk) => chunk.split(/\s+/).filter(Boolean));

  sentenceGroups.forEach((sentenceTokens) => {
    for (let index = 0; index < sentenceTokens.length - 1; index += 1) {
      const left = sentenceTokens[index];
      const right = sentenceTokens[index + 1];
      if (!left || !right) continue;
      if (left.length < 2 || right.length < 2) continue;
      const phrase = `${left} ${right}`.trim();
      const isGratitudePhrase = phrase === 'thank you';
      if (!isGratitudePhrase && (STOPWORDS.has(left) || STOPWORDS.has(right))) continue;
      if (phrase.length < 5) continue;
      phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    }
  });

  const rankedPhrases = Array.from(phraseCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      if (b[0].length !== a[0].length) return b[0].length - a[0].length;
      return a[0].localeCompare(b[0]);
    })
    .map(([phrase]) => phrase);

  const rankedWords = Array.from(wordCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      if (b[0].length !== a[0].length) return b[0].length - a[0].length;
      return a[0].localeCompare(b[0]);
    })
    .map(([word]) => word);

  return dedupeKeywords(rankedPhrases.concat(rankedWords));
}

function extractKeywordsFromText(text, { fallbackName = '', maxKeywords = 12 } = {}) {
  const normalized = normalizeText(text);
  const tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
  const ranked = rankTextKeywords(tokens, text);
  const filenameKeywords = extractKeywordsFromFilename(fallbackName, maxKeywords);
  return dedupeKeywords(ranked.concat(filenameKeywords)).slice(0, maxKeywords);
}

async function transcribeWithWhisper(filePath, {
  whisperBin = process.env.WHISPER_BIN || 'whisper',
  whisperModel = process.env.MEDIA_KEYWORD_WHISPER_MODEL || process.env.WHISPER_MODEL || 'tiny',
  whisperDevice = process.env.MEDIA_KEYWORD_WHISPER_DEVICE || process.env.WHISPER_DEVICE || '',
  timeoutMs = Number(process.env.MEDIA_KEYWORD_TIMEOUT_MS || 180000)
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-keywords-'));
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputJson = path.join(tempDir, `${baseName}.json`);
  const args = [
    filePath,
    '--output_dir', tempDir,
    '--output_format', 'json',
    '--model', whisperModel,
    '--verbose', 'False'
  ];

  if (whisperDevice) {
    args.push('--device', whisperDevice);
  }

  try {
    await execFileAsync(whisperBin, args, {
      timeout: Number.isFinite(timeoutMs) ? timeoutMs : 180000,
      maxBuffer: 8 * 1024 * 1024
    });

    if (!fs.existsSync(outputJson)) {
      return '';
    }

    const parsed = JSON.parse(fs.readFileSync(outputJson, 'utf8'));
    return String(parsed?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function generateMediaKeywords({
  filePath = '',
  displayName = '',
  maxKeywords = 12,
  whisper = {}
} = {}) {
  const safePath = String(filePath || '').trim();
  const fallbackName = String(displayName || path.basename(safePath)).trim();
  const filenameKeywords = extractKeywordsFromFilename(fallbackName, maxKeywords);

  if (!safePath) {
    return {
      keywords: filenameKeywords,
      transcript: '',
      source: 'filename',
      warning: 'Missing media file path'
    };
  }

  try {
    const transcript = await transcribeWithWhisper(safePath, whisper);
    const transcriptKeywords = extractKeywordsFromText(transcript, {
      fallbackName,
      maxKeywords
    });
    return {
      keywords: transcriptKeywords.length > 0 ? transcriptKeywords : filenameKeywords,
      transcript,
      source: transcript ? 'transcript+filename' : 'filename',
      warning: ''
    };
  } catch (err) {
    return {
      keywords: filenameKeywords,
      transcript: '',
      source: 'filename',
      warning: err?.message ? String(err.message) : 'Whisper transcription failed'
    };
  }
}

module.exports = {
  normalizeText,
  extractKeywordsFromFilename,
  extractKeywordsFromText,
  generateMediaKeywords
};
