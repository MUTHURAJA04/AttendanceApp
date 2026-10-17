import {
  cleanName,
  formatCurrentTime,
  speakCheckIn,
  speakDuplicateWarning,
  speakCheckOut,
} from '../services/ttsService';

// Mock react-native-tts
jest.mock('react-native-tts', () => ({
  getInitStatus: jest.fn().mockResolvedValue(true),
  setDefaultLanguage: jest.fn().mockResolvedValue(true),
  setDefaultRate: jest.fn().mockResolvedValue(true),
  setDefaultPitch: jest.fn().mockResolvedValue(true),
  setDucking: jest.fn(),
  stop: jest.fn(),
  speak: jest.fn(),
}));

describe('TTS Service & Voice Greetings', () => {
  describe('cleanName', () => {
    it('removes Mr./Ms./Mrs./Dr. prefixes', () => {
      expect(cleanName('Mr. Raja')).toBe('Raja');
      expect(cleanName('Dr. Karthik')).toBe('Karthik');
      expect(cleanName('Mrs. Priya')).toBe('Priya');
      expect(cleanName('Ms. Ananya')).toBe('Ananya');
    });

    it('strips leading single-letter initials', () => {
      expect(cleanName('M. Raja')).toBe('Raja');
      expect(cleanName('K. Senthil')).toBe('Senthil');
      expect(cleanName('R. K. Narayanan')).toBe('Narayanan');
    });

    it('strips trailing single-letter initials', () => {
      expect(cleanName('Alex S.')).toBe('Alex');
      expect(cleanName('Alex S')).toBe('Alex');
    });

    it('extracts primary first name from multi-word names', () => {
      expect(cleanName('Raja Kumar')).toBe('Raja');
      expect(cleanName('Dr. M. Senthil Kumar')).toBe('Senthil');
    });

    it('handles single names and edge cases gracefully', () => {
      expect(cleanName('raja')).toBe('Raja');
      expect(cleanName('')).toBe('Employee');
      expect(cleanName(null)).toBe('Employee');
    });
  });

  describe('formatCurrentTime', () => {
    it('formats morning time correctly', () => {
      const morningDate = new Date(2026, 9, 16, 9, 5); // 9:05 AM
      expect(formatCurrentTime(morningDate)).toBe('9:05 AM');
    });

    it('formats evening time correctly', () => {
      const eveningDate = new Date(2026, 9, 16, 17, 30); // 5:30 PM
      expect(formatCurrentTime(eveningDate)).toBe('5:30 PM');
    });

    it('formats midnight and noon correctly', () => {
      const midnight = new Date(2026, 9, 16, 0, 0);
      expect(formatCurrentTime(midnight)).toBe('12:00 AM');

      const noon = new Date(2026, 9, 16, 12, 0);
      expect(formatCurrentTime(noon)).toBe('12:00 PM');
    });
  });

  describe('Speech generators', () => {
    it('generates exact check-in greeting', () => {
      const spoken = speakCheckIn('M. Raja', '9:05 AM');
      expect(spoken).toBe('Hello, Raja! Checked IN at 9:05 AM');
    });

    it('generates duplicate warning with singular minute', () => {
      const spoken = speakDuplicateWarning('Alex S.', 1);
      expect(spoken).toBe('Already punched IN 1 minute ago. Please wait.');
    });

    it('generates duplicate warning with plural minutes', () => {
      const spoken = speakDuplicateWarning('Alex S.', 3);
      expect(spoken).toBe('Already punched IN 3 minutes ago. Please wait.');
    });

    it('generates duplicate warning for OUT punch', () => {
      const spoken = speakDuplicateWarning('Alex S.', 2, 'OUT');
      expect(spoken).toBe('Already punched OUT 2 minutes ago. Please wait.');
    });

    it('generates check-out farewell', () => {
      const spoken = speakCheckOut('Dr. Karthik');
      expect(spoken).toBe('Have a nice day, Karthik! Checked OUT.');
    });
  });
});
