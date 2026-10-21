import { NativeModules, Platform } from 'react-native';
import Tts from 'react-native-tts';

let isTtsReady = false;
let lastSpokenText = '';
let lastSpokenTime = 0;

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
 * Spoken Tamil number words (0–60)
 */
export const BASE_TAMIL_NUMBERS = [
  'பூஜ்ஜியம்',     // 0
  'ஒன்று',        // 1
  'இரண்டு',       // 2
  'மூன்று',        // 3
  'நான்கு',        // 4
  'ஐந்து',         // 5
  'ஆறு',          // 6
  'ஏழு',          // 7
  'எட்டு',         // 8
  'ஒன்பது',        // 9
  'பத்து',         // 10
  'பதினொன்று',    // 11
  'பன்னிரண்டு',   // 12
  'பதின்மூன்று',    // 13
  'பதினான்கு',    // 14
  'பதினைந்து',     // 15
  'பதினாறு',      // 16
  'பதினேழு',      // 17
  'பதினெட்டு',     // 18
  'பத்தொன்பது',    // 19
  'இருபது',        // 20
  'இருபத்தொன்று', // 21
  'இருபத்திரண்டு',  // 22
  'இருபத்திமூன்று',  // 23
  'இருபத்திநான்கு',  // 24
  'இருபத்தைந்து',   // 25
  'இருபத்தாறு',    // 26
  'இருபத்தேழு',    // 27
  'இருபத்தெட்டு',   // 28
  'இருபத்தொன்பது',  // 29
  'முப்பது',       // 30
  'முப்பத்தொன்று', // 31
  'முப்பத்திரண்டு',  // 32
  'முப்பத்திமூன்று',  // 33
  'முப்பத்திநான்கு',  // 34
  'முப்பத்தைந்து',   // 35
  'முப்பத்தாறு',    // 36
  'முப்பத்தேழு',    // 37
  'முப்பத்தெட்டு',   // 38
  'முப்பத்தொன்பது',  // 39
  'நாற்பது',       // 40
  'நாற்பத்தொன்று', // 41
  'நாற்பத்திரண்டு',  // 42
  'நாற்பத்திமூன்று',  // 43
  'நாற்பத்திநான்கு',  // 44
  'நாற்பத்தைந்து',   // 45
  'நாற்பத்தாறு',    // 46
  'நாற்பத்தேழு',    // 47
  'நாற்பத்தெட்டு',   // 48
  'நாற்பத்தொன்பது',  // 49
  'ஐம்பது',        // 50
  'ஐம்பத்தொன்று',  // 51
  'ஐம்பத்திரண்டு',   // 52
  'ஐம்பத்திமூன்று',   // 53
  'ஐம்பத்திநான்கு',   // 54
  'ஐம்பத்தைந்து',    // 55
  'ஐம்பத்தாறு',     // 56
  'ஐம்பத்தேழு',     // 57
  'ஐம்பத்தெட்டு',    // 58
  'ஐம்பத்தொன்பது',   // 59
  'அறுபது',        // 60
];

/**
 * Converts numeric integer (0–100) into proper spoken Tamil words:
 * e.g., 1 -> 'ஒன்று', 5 -> 'ஐந்து', 15 -> 'பதினைந்து', 30 -> 'முப்பது'
 * @param {number | string} num
 * @returns {string}
 */
export const numberToTamilWords = (num) => {
  const n = Math.round(Number(num));
  if (isNaN(n) || n < 0) return '';
  if (n <= 60) return BASE_TAMIL_NUMBERS[n];
  if (n === 100) return 'நூறு';
  if (n < 70) {
    const rem = n - 60;
    return rem === 0 ? 'அறுபது' : `அறுபத்தி ${BASE_TAMIL_NUMBERS[rem]}`;
  }
  if (n < 80) {
    const rem = n - 70;
    return rem === 0 ? 'எழுபது' : `எழுபத்தி ${BASE_TAMIL_NUMBERS[rem]}`;
  }
  if (n < 90) {
    const rem = n - 80;
    return rem === 0 ? 'எண்பது' : `எண்பத்தி ${BASE_TAMIL_NUMBERS[rem]}`;
  }
  if (n < 100) {
    const rem = n - 90;
    return rem === 0 ? 'தொண்ணூறு' : `தொண்ணூற்றி ${BASE_TAMIL_NUMBERS[rem]}`;
  }
  return String(n);
};

/**
 * Sanitizes input text before sending to native TTS:
 * - Converts raw digits and time strings with colons into proper spoken Tamil words
 * - Strips any remaining colons ':' so TTS never speaks the word "colon" / "காலன்"
 * - Normalizes whitespace
 * @param {string} text
 * @returns {string}
 */
export const sanitizeForTamilTts = (text) => {
  if (!text || typeof text !== 'string') return '';

  let s = text;

  // 1. Convert time strings like "5:15 மணி", "05:15", "5:00 மணி", "5:00" into spoken Tamil words
  s = s.replace(/(\d{1,2}):(\d{2})(\s*மணி)?/g, (match, h, m) => {
    const hourNum = parseInt(h, 10);
    const minNum = parseInt(m, 10);
    const hourTamil = numberToTamilWords(hourNum);
    if (minNum === 0) {
      return `${hourTamil} மணி`;
    }
    const minTamil = numberToTamilWords(minNum);
    return `${hourTamil} மணி ${minTamil} நிமிடம்`;
  });

  // 2. Convert any remaining standalone numbers (e.g. 5, 10, 45) to Tamil words
  s = s.replace(/\b\d+\b/g, (match) => {
    const num = parseInt(match, 10);
    return numberToTamilWords(num);
  });

  // 3. Remove any remaining colons ':'
  s = s.replace(/:/g, ' ');

  // 4. Normalize multiple whitespaces
  return s.replace(/\s+/g, ' ').trim();
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
  const totalMinutes = (hours * 60) + minutes;

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
 * Format time in spoken Tamil words without colons:
 * - Round hours (e.g. 5:00 PM): "மாலை ஐந்து மணி"
 * - Hours with minutes (e.g. 5:15 PM): "மாலை ஐந்து மணி பதினைந்து நிமிடம்"
 * @param {Date | string | number} [date]
 * @returns {{ session: string, timeString: string, spokenTimeString: string, fullTamilTime: string, numericTimeString: string }}
 */
export const formatTamilTimeComponents = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const session = getTimeOfDaySession(validDate);

  let hours = validDate.getHours() % 12;
  if (hours === 0) hours = 12;
  const minutes = validDate.getMinutes();

  const hourTamil = numberToTamilWords(hours);
  const minuteTamil = minutes > 0 ? numberToTamilWords(minutes) : '';

  // Clean spoken string without colons or raw digits
  let spokenTimeString = '';
  if (minutes > 0) {
    spokenTimeString = `${hourTamil} மணி ${minuteTamil} நிமிடம்`;
  } else {
    spokenTimeString = `${hourTamil} மணி`;
  }

  const fullTamilTime = `${session} ${spokenTimeString}`;

  const timeString = minutes > 0
    ? `${hours}:${minutes < 10 ? '0' + minutes : minutes}`
    : `${hours}`;

  return {
    session,
    timeString: spokenTimeString, // Clean spoken string without colons for backward compatibility
    spokenTimeString,             // "ஐந்து மணி" or "ஐந்து மணி பதினைந்து நிமிடம்"
    fullTamilTime,                // "மாலை ஐந்து மணி" or "மாலை ஐந்து மணி பதினைந்து நிமிடம்"
    fullSpokenTime: fullTamilTime,
    numericTimeString: timeString, // e.g. "5:15"
    hours,
    minutes,
    hourTamil,
    minuteTamil,
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
 * Calculate total work duration for Punch-Out in spoken Tamil:
 * - Elapsed time: punchOutTimestamp - punchInTimestamp
 * - Format: "{X} மணி {Y} நிமிடம்" in Tamil words (e.g. "எட்டு மணி நாற்பத்தைந்து நிமிடம்")
 * - If minutes are 0, format as "{X} மணி" (e.g. "எட்டு மணி")
 * - If hours are 0, format as "{Y} நிமிடம்" (e.g. "நாற்பத்தைந்து நிமிடம்")
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

  const hoursTamil = numberToTamilWords(hours);
  const minutesTamil = numberToTamilWords(minutes);

  if (hours > 0 && minutes > 0) {
    return `${hoursTamil} மணி ${minutesTamil} நிமிடம்`;
  }
  if (hours > 0 && minutes === 0) {
    return `${hoursTamil} மணி`;
  }
  if (hours === 0 && minutes > 0) {
    return `${minutesTamil} நிமிடம்`;
  }
  return null;
};

/**
 * Low-level speak method: stops any ongoing audio immediately and speaks sanitized text
 * Guarantees that raw digits and colons are converted to spoken Tamil words before Tts.speak()
 * @param {string} text
 * @returns {string} The text requested to be spoken
 */
export const speakText = (text) => {
  if (!text) return text;

  // Sanitize to ensure absolutely NO raw digits or colons reach the native TTS engine
  const cleanSpeechText = sanitizeForTamilTts(text);

  // Prevent rapid duplicate spam: ignore identical utterances within 8 seconds
  const now = Date.now();
  if (cleanSpeechText === lastSpokenText && (now - lastSpokenTime) < 8000) {
    return text;
  }
  lastSpokenText = cleanSpeechText;
  lastSpokenTime = now;

  if (!isTtsAvailable()) {
    console.warn('[TTS] Cannot speak: Native TextToSpeech module not loaded in running binary.');
    return text;
  }
  try {
    if (!isTtsReady) {
      initTts().then((ready) => {
        if (ready) {
          Tts.stop();
          Tts.speak(cleanSpeechText);
        }
      }).catch(() => {});
    } else {
      Tts.stop();
      Tts.speak(cleanSpeechText);
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
  lastSpokenText = '';
  lastSpokenTime = 0;
  if (!isTtsAvailable()) return;
  try {
    Tts.stop();
  } catch (err) {
    console.warn('[TTS] Failed to stop TTS:', err);
  }
};

/**
 * Announce Punch-IN in Tamil (Pure spoken Tamil words, zero digits/colons):
 * Target: "வணக்கம் {Name}! வருகை நேரம், {Session} {SpokenTime}."
 * Example: "வணக்கம் ராஜா! வருகை நேரம், காலை ஒன்பது மணி முப்பது நிமிடம்."
 * Round hour: "வணக்கம் ராஜா! வருகை நேரம், காலை ஒன்பது மணி."
 * @param {string} name Employee name
 * @param {Date | string | number} [timestamp] Check-in timestamp
 * @returns {string} The exact spoken announcement text
 */
export const speakCheckIn = (name, timestamp = new Date()) => {
  const primaryName = cleanName(name);
  const { fullTamilTime } = formatTamilTimeComponents(timestamp);
  const text = `வணக்கம் ${primaryName}! வருகை நேரம், ${fullTamilTime}.`;
  speakText(text);
  return text;
};

/**
 * Announce Punch-OUT in Tamil (Pure spoken Tamil words, zero digits/colons):
 * Target: "நன்றி {Name}! புறப்பாடு நேரம், {Session} {SpokenTime}. மொத்த வேலை நேரம், {Hours} மணி {Minutes} நிமிடம்."
 * Example: "நன்றி ராஜா! புறப்பாடு நேரம், மாலை ஆறு மணி பதினைந்து நிமிடம். மொத்த வேலை நேரம், எட்டு மணி நாற்பத்தைந்து நிமிடம்."
 * Fallback (if punch-in unavailable): "நன்றி {Name}! புறப்பாடு நேரம், {Session} {SpokenTime}."
 * @param {string} name Employee name
 * @param {Date | string | number} [punchOutTimestamp] Check-out timestamp
 * @param {Date | string | number | null} [punchInTimestamp] Corresponding check-in timestamp
 * @returns {string} The exact spoken announcement text
 */
export const speakCheckOut = (name, punchOutTimestamp = new Date(), punchInTimestamp = null) => {
  const primaryName = cleanName(name);
  const { fullTamilTime } = formatTamilTimeComponents(punchOutTimestamp);
  const durationStr = calculateWorkDuration(punchInTimestamp, punchOutTimestamp);

  let text = '';
  if (durationStr) {
    text = `நன்றி ${primaryName}! புறப்பாடு நேரம், ${fullTamilTime}. மொத்த வேலை நேரம், ${durationStr}.`;
  } else {
    text = `நன்றி ${primaryName}! புறப்பாடு நேரம், ${fullTamilTime}.`;
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
  const minsTamil = mins === 1 ? 'ஒரு' : numberToTamilWords(mins);
  const action = String(lastType).toUpperCase() === 'OUT' ? 'புறப்பாடு' : 'வருகை';
  const text = `ஏற்கனவே ${minsTamil} நிமிடம் முன் ${action} பதிவு செய்யப்பட்டது. தயவுசெய்து காத்திருக்கவும்.`;
  speakText(text);
  return text;
};

export default {
  initTts,
  cleanName,
  numberToTamilWords,
  sanitizeForTamilTts,
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
