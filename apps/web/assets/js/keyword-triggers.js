(function initKeywordTriggersModule() {
  function createKeywordTriggersController({
    windowRef,
    callbacks = {}
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const roundRobinState = {
      animation: {},
      sound: {}
    };
    const MIC_MIN_KEYWORD_CHARS = 5;

    function stripDiacritics(value) {
      const raw = String(value || '');
      if (typeof raw.normalize !== 'function') return raw;
      return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function normalizeText(value) {
      return stripDiacritics(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function parseKeywordList(value) {
      const rawEntries = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,]/);
      const unique = [];

      rawEntries.forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (!normalized) return;
        if (unique.some((item) => item.toLowerCase() === normalized.toLowerCase())) return;
        unique.push(normalized);
      });

      return unique;
    }

    function levenshteinDistance(a, b) {
      const left = String(a || '');
      const right = String(b || '');
      if (left === right) return 0;
      if (!left.length) return right.length;
      if (!right.length) return left.length;

      const prev = new Array(right.length + 1);
      const curr = new Array(right.length + 1);
      for (let j = 0; j <= right.length; j += 1) prev[j] = j;

      for (let i = 1; i <= left.length; i += 1) {
        curr[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
          const cost = left[i - 1] === right[j - 1] ? 0 : 1;
          curr[j] = Math.min(
            prev[j] + 1,
            curr[j - 1] + 1,
            prev[j - 1] + cost
          );
        }
        for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
      }

      return prev[right.length];
    }

    function similarity(left, right) {
      const a = String(left || '');
      const b = String(right || '');
      if (!a || !b) return 0;
      const maxLen = Math.max(a.length, b.length);
      if (!maxLen) return 0;
      return 1 - (levenshteinDistance(a, b) / maxLen);
    }

    function containsExactKeywordSequence(messageText, keyword) {
      const normalizedMessage = normalizeText(messageText);
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedMessage || !normalizedKeyword) return false;

      const messageTokens = normalizedMessage.split(' ').filter(Boolean);
      const keywordTokens = normalizedKeyword.split(' ').filter(Boolean);
      if (messageTokens.length === 0 || keywordTokens.length === 0) return false;

      if (keywordTokens.length === 1) {
        if (normalizedKeyword.length < MIC_MIN_KEYWORD_CHARS) return false;
        return messageTokens.includes(normalizedKeyword);
      }

      for (let index = 0; index <= messageTokens.length - keywordTokens.length; index += 1) {
        const windowTokens = messageTokens.slice(index, index + keywordTokens.length);
        if (windowTokens.join(' ') === normalizedKeyword) {
          return true;
        }
      }

      return false;
    }

    function scoreStrictMicMatch(messageText, keyword) {
      const normalizedMessage = normalizeText(messageText);
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedMessage || !normalizedKeyword) return 0;

      const messageTokens = normalizedMessage.split(' ').filter(Boolean);
      const keywordTokens = normalizedKeyword.split(' ').filter(Boolean);
      if (messageTokens.length === 0 || keywordTokens.length === 0) return 0;

      if (keywordTokens.length === 1) {
        if (normalizedKeyword.length < 4) return 0;
        if (messageTokens.includes(normalizedKeyword)) return 1;

        let bestScore = 0;
        messageTokens.forEach((token) => {
          if (Math.abs(token.length - normalizedKeyword.length) > 2) return;
          const tokenScore = similarity(token, normalizedKeyword);
          if (tokenScore > bestScore) bestScore = tokenScore;
        });

        const threshold = normalizedKeyword.length >= 8 ? 0.88 : 0.82;
        return bestScore >= threshold ? bestScore : 0;
      }

      let bestScore = 0;
      const windowLengths = Array.from(new Set([
        keywordTokens.length,
        Math.max(1, keywordTokens.length - 1),
        keywordTokens.length + 1
      ]));

      windowLengths.forEach((windowLength) => {
        for (let index = 0; index <= messageTokens.length - windowLength; index += 1) {
          const windowText = messageTokens.slice(index, index + windowLength).join(' ');
          if (windowText === normalizedKeyword) {
            bestScore = Math.max(bestScore, 1);
            continue;
          }
          const phraseScore = similarity(windowText, normalizedKeyword);
          const compactScore = similarity(
            windowText.replace(/\s+/g, ''),
            normalizedKeyword.replace(/\s+/g, '')
          );
          const candidate = Math.max(phraseScore, compactScore);
          if (candidate > bestScore) bestScore = candidate;
        }
      });

      return bestScore >= 0.9 ? bestScore : 0;
    }

    function scoreKeywordMatch(messageText, keyword, options = {}) {
      const normalizedMessage = normalizeText(messageText);
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedMessage || !normalizedKeyword) return 0;
      const strict = options.strict === true;
      if (strict) {
        return scoreStrictMicMatch(normalizedMessage, normalizedKeyword);
      }

      if (normalizedMessage.includes(normalizedKeyword)) return 1;

      const compactMessage = normalizedMessage.replace(/\s+/g, '');
      const compactKeyword = normalizedKeyword.replace(/\s+/g, '');
      if (compactKeyword.length >= 4 && compactMessage.includes(compactKeyword)) {
        return 0.96;
      }

      const messageTokens = normalizedMessage.split(' ').filter(Boolean);
      const keywordTokens = normalizedKeyword.split(' ').filter(Boolean);
      if (messageTokens.length === 0 || keywordTokens.length === 0) return 0;

      let bestScore = 0;
      if (keywordTokens.length === 1) {
        messageTokens.forEach((token) => {
          const tokenScore = similarity(token, normalizedKeyword);
          if (tokenScore > bestScore) bestScore = tokenScore;
        });
      } else {
        const windowLengths = Array.from(new Set([
          keywordTokens.length,
          Math.max(1, keywordTokens.length - 1),
          keywordTokens.length + 1
        ]));

        windowLengths.forEach((windowLength) => {
          for (let index = 0; index <= messageTokens.length - windowLength; index += 1) {
            const windowText = messageTokens.slice(index, index + windowLength).join(' ');
            const phraseScore = similarity(windowText, normalizedKeyword);
            if (phraseScore > bestScore) bestScore = phraseScore;

            const compactWindow = windowText.replace(/\s+/g, '');
            const compactScore = similarity(compactWindow, compactKeyword);
            if (compactScore > bestScore) bestScore = compactScore;
          }
        });
      }

      const minLength = Math.min(compactKeyword.length, compactMessage.length);
      const threshold = keywordTokens.length > 1
        ? 0.72
        : (minLength <= 4 ? 0.9 : 0.82);

      return bestScore >= threshold ? bestScore : 0;
    }

    function toEntryId(entry = {}) {
      return String(entry.id || entry.trigger || entry.soundPath || '').trim();
    }

    function sortMatches(matches = []) {
      return matches.slice().sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.keyword.length !== left.keyword.length) return right.keyword.length - left.keyword.length;
        return toEntryId(left).localeCompare(toEntryId(right));
      });
    }

    function findMatches(messageText, entries = [], kind = '', options = {}) {
      const byEntryId = new Map();

      entries.forEach((entry) => {
        const entryId = toEntryId(entry);
        if (!entryId) return;

        const keywords = parseKeywordList(entry?.keywords);
        let bestForEntry = null;
        keywords.forEach((keyword) => {
          const score = scoreKeywordMatch(messageText, keyword, options);
          if (!score) return;

          if (!bestForEntry
            || score > bestForEntry.score
            || (score === bestForEntry.score && keyword.length > bestForEntry.keyword.length)
          ) {
            bestForEntry = {
              id: entryId,
              kind,
              score,
              keyword,
              ...entry
            };
          }
        });

        if (bestForEntry) {
          byEntryId.set(entryId, bestForEntry);
        }
      });

      return sortMatches(Array.from(byEntryId.values()));
    }

    function pickRoundRobinMatch(matches = [], kind = '') {
      if (!Array.isArray(matches) || matches.length === 0) return null;
      if (matches.length === 1) return matches[0];

      const rrBucket = roundRobinState[kind] || (roundRobinState[kind] = {});
      const key = matches.map((entry) => toEntryId(entry)).join('|');
      const currentIndex = Number(rrBucket[key] || 0);
      const selected = matches[currentIndex % matches.length];
      rrBucket[key] = (currentIndex + 1) % matches.length;
      return selected;
    }

    function pickBestMatch(matches = [], kind = '') {
      if (!Array.isArray(matches) || matches.length === 0) return null;
      const [best] = matches;
      if (!best) return null;

      const topCandidates = matches.filter((entry) => (
        entry.score === best.score
        && entry.keyword.length === best.keyword.length
      ));

      return pickRoundRobinMatch(topCandidates, kind);
    }

    function buildAnimationEntries(options = {}) {
      const source = String(options.source || 'viewer-chat').trim().toLowerCase();
      const mappings = callbacks.getAnimationMappings?.() || {};
      return Object.entries(mappings)
        .map(([trigger, data]) => {
          const normalized = callbacks.normalizeAnimationMapping?.(data, trigger) || data || {};
          return {
            id: String(trigger || '').trim(),
            trigger: String(trigger || '').trim(),
            keywords: Array.isArray(normalized?.keywords) ? normalized.keywords : [],
            viewerEnabled: normalized?.keywordTriggerEnabled === true,
            voiceEnabled: normalized?.voiceKeywordTriggerEnabled === true
          };
        })
        .filter((entry) => entry.trigger && entry.keywords.length > 0)
        .filter((entry) => source === 'mic' ? entry.voiceEnabled : entry.viewerEnabled);
    }

    function buildSoundEntries(options = {}) {
      const source = String(options.source || 'viewer-chat').trim().toLowerCase();
      const entries = source === 'mic'
        ? (callbacks.getAllSoundKeywordEntries?.() || callbacks.getSoundKeywordEntries?.() || [])
        : (callbacks.getSoundKeywordEntries?.() || []);
      return entries
        .map((entry) => ({
          id: String(entry?.soundPath || '').trim(),
          soundPath: String(entry?.soundPath || '').trim(),
          keywords: parseKeywordList(entry?.keywords),
          viewerEnabled: entry?.viewerEnabled === true,
          voiceEnabled: entry?.voiceEnabled === true
        }))
        .filter((entry) => entry.soundPath && entry.keywords.length > 0)
        .filter((entry) => source === 'mic' ? entry.voiceEnabled : entry.viewerEnabled);
    }

    function buildSuppressedKeywordSet(source = '') {
      if (String(source || '').trim().toLowerCase() !== 'mic') {
        return new Set();
      }
      const rawKeywords = callbacks.getSuppressedKeywords?.({ source: 'mic' }) || [];
      const suppressed = new Set();
      rawKeywords.forEach((keyword) => {
        const normalized = normalizeText(keyword);
        if (!normalized) return;
        suppressed.add(normalized);
      });
      return suppressed;
    }

    function hasExactMicKeywordMatch(text = '') {
      const suppressedKeywords = buildSuppressedKeywordSet('mic');
      const entries = buildAnimationEntries({ source: 'mic' }).concat(buildSoundEntries({ source: 'mic' }));
      return entries.some((entry) => {
        const keywords = parseKeywordList(entry?.keywords);
        return keywords.some((keyword) => {
          const normalizedKeyword = normalizeText(keyword);
          if (!normalizedKeyword || suppressedKeywords.has(normalizedKeyword)) {
            return false;
          }
          return containsExactKeywordSequence(text, keyword);
        });
      });
    }

    function handleMessage({ author = '', platform = '', text = '', source = 'viewer-chat', previewOnly = false } = {}) {
      const normalizedText = String(text || '').trim();
      if (!normalizedText) {
        return { animationMatch: null, soundMatch: null };
      }

      const normalizedSource = String(source || 'viewer-chat').trim().toLowerCase();
      const strictMicMatching = normalizedSource === 'mic';
      const suppressedKeywords = buildSuppressedKeywordSet(normalizedSource);
      const filterSuppressedMatches = (matches = []) => matches.filter((entry) => (
        !suppressedKeywords.has(normalizeText(entry.keyword))
      ));

      const rawAnimationMatches = findMatches(
        normalizedText,
        buildAnimationEntries({ source: normalizedSource }),
        'animation',
        { strict: strictMicMatching }
      );
      const rawSoundMatches = findMatches(
        normalizedText,
        buildSoundEntries({ source: normalizedSource }),
        'sound',
        { strict: strictMicMatching }
      );
      const animationMatches = filterSuppressedMatches(rawAnimationMatches);
      const soundMatches = filterSuppressedMatches(rawSoundMatches);
      const animationMatch = pickBestMatch(animationMatches, 'animation');
      const soundMatch = pickBestMatch(soundMatches, 'sound');
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      const normalizedAuthor = String(author || '').trim();
      const animationAlreadyPlaying = callbacks.hasActiveAnimations?.() === true;
      const canUseAnimation = Boolean(
        animationMatch
        && normalizedAuthor
        && normalizedPlatform
        && (normalizedSource === 'mic' || callbacks.canTriggerAnimation?.(normalizedAuthor, normalizedPlatform) !== false)
      );

      let playedKind = '';
      let blockedByActiveAnimation = false;

      if (!previewOnly && canUseAnimation) {
        if (animationAlreadyPlaying) {
          blockedByActiveAnimation = true;
        } else if (callbacks.triggerAnimation?.(animationMatch.trigger, normalizedPlatform, normalizedAuthor, 'keyword')) {
          playedKind = 'animation';
        }
      } else if (!previewOnly && animationAlreadyPlaying) {
        blockedByActiveAnimation = true;
      }

      if (!previewOnly && !playedKind && !blockedByActiveAnimation && !canUseAnimation && soundMatch) {
        if (callbacks.playSound?.(soundMatch.soundPath)) {
          playedKind = 'sound';
        }
      }

      return {
        animationMatch,
        soundMatch,
        animationMatches,
        soundMatches,
        ignoredBySuppressedKeywords: normalizedSource === 'mic'
          && suppressedKeywords.size > 0
          && rawAnimationMatches.concat(rawSoundMatches).length > 0
          && animationMatches.length === 0
          && soundMatches.length === 0,
        suppressedKeywords: Array.from(suppressedKeywords),
        playedKind,
        blockedByActiveAnimation
      };
    }

    return {
      parseKeywordList,
      normalizeText,
      scoreKeywordMatch,
      findMatches,
      hasExactMicKeywordMatch,
      handleMessage
    };
  }

  if (typeof window !== 'undefined') {
    window.createKeywordTriggersController = createKeywordTriggersController;
  }
})();
