import { NativeModules, Platform } from 'react-native';
import Tts from 'react-native-tts';

let isTtsReady = false;

/**
 * Check if the native TextToSpeech module is linked in the running native binary
 */
export const isTtsAvailable = () => {
  if (Platform.OS === 'ios' || Platform.OS === 'windows') return true;
  return Boolean(NativeModules && NativeModules.TextToSpeech);
};

/**
 * Initialize TTS with Tamil (ta-IN) language support, natural speech rate (0.50), pitch 1.0 and audio ducking.
 */
export const initTts = async () => {
  if (isTtsReady) return true;
  if (!isTtsAvailable()) {
    console.warn(
      '[TTS] Native TextToSpeech module is not linked in the current binary.',
    );
    return false;
  }
  try {
    await Tts.getInitStatus();

    // Configure Tamil language (ta-IN)
    let langSet = false;
    try {
      await Tts.setDefaultLanguage('ta-IN');
      langSet = true;
    } catch {
      try {
        await Tts.setDefaultLanguage('ta');
        langSet = true;
      } catch (err) {
        console.warn('[TTS] ta-IN not immediately available, checking voices:', err);
      }
    }

    // Attempt to select an explicit Tamil voice if available on device
    try {
      const voices = await Tts.voices();
      if (Array.isArray(voices)) {
        const tamilVoice = voices.find(
          (v) =>
            (v.language && v.language.toLowerCase().startsWith('ta')) ||
            (v.id && v.id.toLowerCase().includes('ta-in')),
        );
        if (tamilVoice) {
          await Tts.setDefaultVoice(tamilVoice.id);
          console.log('[TTS] Selected Tamil voice:', tamilVoice.id);
        }
      }
    } catch (voiceErr) {
      console.warn('[TTS] Voice lookup non-blocking warning:', voiceErr);
    }

    await Tts.setDefaultRate(0.50);
    await Tts.setDefaultPitch(1.0);
    Tts.setDucking(true);
    isTtsReady = true;
    console.log(`[TTS] Initialized: language=${langSet ? 'ta-IN' : 'default'}, rate=0.50, pitch=1.0, ducking=true`);
    return true;
  } catch (err) {
    console.warn('[TTS] Initialization error:', err);
    return false;
  }
};

// Initialize proactively on import
initTts().catch((e) => console.warn('[TTS] Proactive init warning:', e));

/**
 * Clean employee full name for natural TTS pronunciation:
 * - Strips honorifics (Mr., Ms., Mrs., Dr., Prof., திரு, திருமதி, செல்வி)
 * - Strips leading and trailing single-letter initials (e.g. "M. Raja" -> "Raja", "Alex S." -> "Alex", "ராஜா M." -> "ராஜா")
 * - Handles both Tamil and Latin script names seamlessly
 * @param {string} fullName
 * @returns {string}
 */
export const cleanName = (fullName) => {
  if (!fullName || typeof fullName !== 'string') return 'நண்பரே';

  // 1. Remove prefixes (Mr., Ms., Mrs., Dr., Prof., திரு, திருமதி, etc.)
  let cleaned = fullName.trim().replace(/^(mr|ms|mrs|dr|prof|திரு|திருமதி|செல்வி)\.?\s+/i, '');

  // 2. Remove leading single-letter initials (e.g. "M. ", "A. ", "M ", "R. K. ", "எஸ். ")
  cleaned = cleaned.replace(/^([a-zA-Z\u0B80-\u0BFF]\.?\s+)+/, '');

  // 3. Remove trailing single-letter initials (e.g. " S.", " S", " M.")
  cleaned = cleaned.replace(/(\s+[a-zA-Z\u0B80-\u0BFF]\.?)+$/, '');

  // 4. Split remaining tokens by whitespace
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'நண்பரே';

  const firstToken = tokens[0].trim();

  // If token contains Tamil script characters (\u0B80-\u0BFF), return as-is
  if (/[\u0B80-\u0BFF]/.test(firstToken)) {
    return firstToken;
  }

  // If token is Latin alphabet, clean non-alpha and format title case
  const lettersOnly = firstToken.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 1) {
    return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
  }

  return firstToken || 'நண்பரே';
};

/**
 * Time of Day (Session) Mapping in Tamil:
 * - 04:00 to 11:59 -> "காலை"
 * - 12:00 to 15:59 -> "மதியம்"
 * - 16:00 to 19:59 -> "மாலை"
 * - 20:00 to 03:59 -> "இரவு"
 * @param {Date | string | number} [date]
 * @returns {'காலை' | 'மதியம்' | 'மாலை' | 'இரவு'}
 */
export const getTimeOfDaySession = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const hours = isNaN(d.getTime()) ? new Date().getHours() : d.getHours();
  const minutes = isNaN(d.getTime()) ? new Date().getMinutes() : d.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // 04:00 (240 min) to 11:59 (719 min) -> காலை
  if (totalMinutes >= 240 && totalMinutes <= 719) {
    return 'காலை';
  }
  // 12:00 (720 min) to 15:59 (959 min) -> மதியம்
  if (totalMinutes >= 720 && totalMinutes <= 959) {
    return 'மதியம்';
  }
  // 16:00 (960 min) to 19:59 (1199 min) -> மாலை
  if (totalMinutes >= 960 && totalMinutes <= 1199) {
    return 'மாலை';
  }
  // 20:00 (1200 min) to 03:59 (239 min) -> இரவு
  return 'இரவு';
};

/**
 * Format time in Tamil 12-hour format:
 * - 12-hour format (12 instead of 00 or 24).
 * - Append minutes with leading zeroes if minutes > 0 (e.g. 9:30, 6:05).
 * - If minutes == 0, speak just the hour (e.g. 9, so "காலை 9 மணி").
 * @param {Date | string | number} [date]
 * @returns {{ session: string, timeString: string, fullTamilTime: string }}
 */
export const formatTamilTimeComponents = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const session = getTimeOfDaySession(validDate);

  let hours = validDate.getHours() % 12;
  if (hours === 0) hours = 12;
  const minutes = validDate.getMinutes();

  const timeString = minutes > 0
    ? `${hours}:${minutes < 10 ? '0' + minutes : minutes}`
    : `${hours}`;

  return {
    session,
    timeString,
    fullTamilTime: `${session} ${timeString} மணி`,
  };
};

/**
 * Format standard time string like "9:05 AM" (legacy helper)
 * @param {Date} [date]
 * @returns {string}
 */
export const formatCurrentTime = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minutesStr} ${ampm}`;
};

/**
 * Calculate total work duration for Punch-Out:
 * - Elapsed time: punchOutTimestamp - punchInTimestamp
 * - Format: "{X} மணி {Y} நிமிடம்"
 * - If minutes are 0, format as "{X} மணி"
 * - If hours are 0, format as "{Y} நிமிடம்"
 * - If punch-in record is unavailable or corrupt, returns null
 * @param {string | Date | number} punchInTimestamp
 * @param {string | Date | number} [punchOutTimestamp]
 * @returns {string | null}
 */
export const calculateWorkDuration = (punchInTimestamp, punchOutTimestamp = new Date()) => {
  if (!punchInTimestamp) return null;
  const inTime = new Date(punchInTimestamp).getTime();
  const outTime = new Date(punchOutTimestamp).getTime();

  if (isNaN(inTime) || isNaN(outTime) || outTime <= inTime) {
    return null;
  }

  const elapsedMs = outTime - inTime;
  const totalMinutes = Math.floor(elapsedMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} மணி ${minutes} நிமிடம்`;
  }
  if (hours > 0 && minutes === 0) {
    return `${hours} மணி`;
  }
  if (hours === 0 && minutes > 0) {
    return `${minutes} நிமிடம்`;
  }
  return null;
};

/**
 * Low-level speak method: stops any ongoing audio immediately and speaks new text
 * @param {string} text
 * @returns {string} The text requested to be spoken
 */
export const speakText = (text) => {
  if (!text) return text;
  if (!isTtsAvailable()) {
    console.warn('[TTS] Cannot speak: Native TextToSpeech module not loaded in running binary.');
    return text;
  }
  try {
    if (!isTtsReady) {
      initTts().then((ready) => {
        if (ready) {
          Tts.stop();
          Tts.speak(text);
        }
      }).catch(() => {});
    } else {
      Tts.stop();
      Tts.speak(text);
    }
  } catch (err) {
    console.warn('[TTS] Failed to speak:', err);
  }
  return text;
};

/**
 * Stop any ongoing TTS speech immediately
 */
export const stopTts = () => {
  if (!isTtsAvailable()) return;
  try {
    Tts.stop();
  } catch (err) {
    console.warn('[TTS] Failed to stop TTS:', err);
  }
};

/**
 * Announce Punch-IN in Tamil:
 * Target: "வணக்கம் {Name}! வருகை நேரம், {Session} {Time} மணி."
 * Example: "வணக்கம் ராஜா! வருகை நேரம், காலை 9:30 மணி."
 * @param {string} name Employee name
 * @param {Date | string | number} [timestamp] Check-in timestamp
 * @returns {string} The exact spoken announcement text
 */
export const speakCheckIn = (name, timestamp = new Date()) => {
  const primaryName = cleanName(name);
  const { session, timeString } = formatTamilTimeComponents(timestamp);
  const text = `வணக்கம் ${primaryName}! வருகை நேரம், ${session} ${timeString} மணி.`;
  speakText(text);
  return text;
};

/**
 * Announce Punch-OUT in Tamil:
 * Target: "நன்றி {Name}! புறப்பாடு நேரம், {Session} {Time} மணி. மொத்த வேலை நேரம், {Hours} மணி {Minutes} நிமிடம்."
 * Example: "நன்றி ராஜா! புறப்பாடு நேரம், மாலை 6:15 மணி. மொத்த வேலை நேரம், 8 மணி 45 நிமிடம்."
 * Fallback (if punch-in unavailable): "நன்றி {Name}! புறப்பாடு நேரம், {Session} {Time} மணி."
 * @param {string} name Employee name
 * @param {Date | string | number} [punchOutTimestamp] Check-out timestamp
 * @param {Date | string | number | null} [punchInTimestamp] Corresponding check-in timestamp
 * @returns {string} The exact spoken announcement text
 */
export const speakCheckOut = (name, punchOutTimestamp = new Date(), punchInTimestamp = null) => {
  const primaryName = cleanName(name);
  const { session, timeString } = formatTamilTimeComponents(punchOutTimestamp);
  const durationStr = calculateWorkDuration(punchInTimestamp, punchOutTimestamp);

  let text = '';
  if (durationStr) {
    text = `நன்றி ${primaryName}! புறப்பாடு நேரம், ${session} ${timeString} மணி. மொத்த வேலை நேரம், ${durationStr}.`;
  } else {
    text = `நன்றி ${primaryName}! புறப்பாடு நேரம், ${session} ${timeString} மணி.`;
  }

  speakText(text);
  return text;
};

/**
 * Announce Duplicate Punch Warning in Tamil:
 * Utter: "ஏற்கனவே [X] நிமிடம் முன் [வருகை/புறப்பாடு] பதிவு செய்யப்பட்டது. தயவுசெய்து காத்திருக்கவும்."
 * @param {string} name Employee name
 * @param {number} minutesAgo Minutes since last punch
 * @param {string} [lastType] 'IN' or 'OUT'
 * @returns {string} The exact spoken announcement text
 */
export const speakDuplicateWarning = (name, minutesAgo, lastType = 'IN') => {
  const mins = Math.max(1, Math.round(minutesAgo || 1));
  const action = String(lastType).toUpperCase() === 'OUT' ? 'புறப்பாடு' : 'வருகை';
  const text = `ஏற்கனவே ${mins} நிமிடம் முன் ${action} பதிவு செய்யப்பட்டது. தயவுசெய்து காத்திருக்கவும்.`;
  speakText(text);
  return text;
};

export default {
  initTts,
  cleanName,
  getTimeOfDaySession,
  formatTamilTimeComponents,
  calculateWorkDuration,
  formatCurrentTime,
  speakText,
  stopTts,
  speakCheckIn,
  speakDuplicateWarning,
  speakCheckOut,
};
