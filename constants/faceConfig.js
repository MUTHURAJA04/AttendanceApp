import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const FACE_CONFIG = {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  GUIDE_BOX_SIZE: Math.floor(SCREEN_WIDTH * 0.72),
  
  // MobileFaceNet Input Dimensions & Embedding
  MODEL_INPUT_WIDTH: 112,
  MODEL_INPUT_HEIGHT: 112,
  EMBEDDING_SIZE: 512,
  NORMALIZATION_EPSILON: 1e-12,

  // Recognition & Verification
  DEFAULT_SIMILARITY_THRESHOLD: 0.78,
  MIN_MATCH_MARGIN: 0.08,
  CONSECUTIVE_MATCH_FRAMES: 2,
  
  // Enrollment settings
  ENROLLMENT_SAMPLE_TARGET: 10,
  SAMPLE_INTERVAL_MS: 200,

  // Liveness (Blink) thresholds & Pose Gates
  EYE_CLOSED_THRESHOLD: 0.25,
  EYE_OPEN_THRESHOLD: 0.65,
  MAX_HEAD_YAW_DEGREES: 18,
  MAX_HEAD_PITCH_DEGREES: 14,
  MAX_HEAD_ROLL_DEGREES: 10,
  MIN_FACE_BOX_SIZE: 120,

  // Lockout / Debounce timing
  PUNCH_COOLDOWN_MINUTES: 2,
  PUNCH_SUCCESS_LOCKOUT_MS: 4000,
  PUNCH_DUPLICATE_LOCKOUT_MS: 3500,
};
