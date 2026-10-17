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
 * Initialize TTS with Indian English locale, natural speech rate (0.50), pitch 1.0 and audio ducking.
 */
export const initTts = async () => {
  if (isTtsReady) return true;
  if (!isTtsAvailable()) {
    console.warn(
      '[TTS] Native TextToSpeech module is not linked in the current APK build. Please rebuild the app (e.g. npx react-native run-android) so the native TTS library is installed on the device.',
    );
    return false;
  }
  try {
    await Tts.getInitStatus();
    try {
      await Tts.setDefaultLanguage('en-IN');
    } catch (langErr) {
      console.warn('[TTS] en-IN language not available, falling back to default:', langErr);
    }
    await Tts.setDefaultRate(0.50);
    await Tts.setDefaultPitch(1.0);
    Tts.setDucking(true);
    isTtsReady = true;
    console.log('[TTS] Initialized: locale=en-IN, rate=0.50, pitch=1.0, ducking=true');
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
 * - Strips honorifics (Mr., Ms., Mrs., Dr., Prof.)
 * - Strips single-letter initials (e.g. "M. Raja" -> "Raja", "Alex S." -> "Alex")
 * - Returns only the primary first name
 * @param {string} fullName
 * @returns {string}
 */
export const cleanName = (fullName) => {
  if (!fullName || typeof fullName !== 'string') return 'Employee';

  // 1. Remove prefixes (Mr., Ms., Mrs., Dr., Prof., etc.)
  let cleaned = fullName.trim().replace(/^(mr|ms|mrs|dr|prof)\.?\s+/i, '');

  // 2. Remove leading single-letter initials (e.g. "M. ", "A. ", "M ", "R. K. ")
  cleaned = cleaned.replace(/^([a-zA-Z]\.?\s+)+/, '');

  // 3. Remove trailing single-letter initials (e.g. " S.", " S", " M.")
  cleaned = cleaned.replace(/(\s+[a-zA-Z]\.?)+$/, '');

  // 4. Split remaining tokens by whitespace
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'Employee';

  // Find the first token that is a full name (>1 alpha character)
  for (const token of tokens) {
    const lettersOnly = token.replace(/[^a-zA-Z]/g, '');
    if (lettersOnly.length > 1) {
      return lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
    }
  }

  // Fallback to first alphanumeric token
  const fallback = tokens[0].replace(/[^a-zA-Z]/g, '');
  return fallback
    ? fallback.charAt(0).toUpperCase() + fallback.slice(1).toLowerCase()
    : 'Employee';
};

/**
 * Format time like "9:05 AM" or "5:30 PM"
 * @param {Date} [date]
 * @returns {string}
 */
export const formatCurrentTime = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 hour represents 12 AM
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minutesStr} ${ampm}`;
};

/**
 * Low-level speak method: stops any ongoing audio and speaks new text
 * @param {string} text
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
 * Announce Check-IN:
 * Utter: "Hello, [Name]! Checked IN at [Time]"
 * @param {string} name
 * @param {string} [timeString]
 * @returns {string} The spoken announcement text
 */
export const speakCheckIn = (name, timeString) => {
  const primaryName = cleanName(name);
  const time = timeString || formatCurrentTime();
  const text = `Hello, ${primaryName}! Checked IN at ${time}`;
  speakText(text);
  return text;
};

/**
 * Announce Duplicate Punch Warning:
 * Utter: "Already punched IN [X] minute ago. Please wait." (handles singular/plural minute vs minutes)
 * @param {string} name
 * @param {number} minutesAgo
 * @param {string} [lastType]
 * @returns {string} The spoken announcement text
 */
export const speakDuplicateWarning = (name, minutesAgo, lastType = 'IN') => {
  const mins = Math.max(1, Math.round(minutesAgo || 1));
  const unit = mins === 1 ? 'minute' : 'minutes';
  const typeStr = String(lastType).toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const text = `Already punched ${typeStr} ${mins} ${unit} ago. Please wait.`;
  speakText(text);
  return text;
};

/**
 * Announce Check-OUT:
 * Utter: "Have a nice day, [Name]! Checked OUT."
 * @param {string} name
 * @returns {string} The spoken announcement text
 */
export const speakCheckOut = (name) => {
  const primaryName = cleanName(name);
  const text = `Have a nice day, ${primaryName}! Checked OUT.`;
  speakText(text);
  return text;
};

export default {
  initTts,
  cleanName,
  formatCurrentTime,
  speakText,
  stopTts,
  speakCheckIn,
  speakDuplicateWarning,
  speakCheckOut,
};
