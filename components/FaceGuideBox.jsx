import React from 'react';
import { StyleSheet, View, Text, useWindowDimensions } from 'react-native';

/**
 * Reusable Face Alignment Guide Box with dynamic border states and guidance pill
 * @param {object} props
 * @param {'DEFAULT' | 'ALIGNED' | 'IDENTIFIED' | 'MATCH' | 'WARNING'} props.boxState
 * @param {string} props.promptText
 * @param {string} [props.subText]
 * @param {boolean} [props.isIdentified]
 */
export default function FaceGuideBox({
  boxState = 'DEFAULT',
  promptText = 'Position Face in Box',
  subText = 'Keep face steady inside frame',
  isIdentified = false,
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const boxSize = Math.floor(screenWidth * 0.72);
  const boxTop = (screenHeight - boxSize) / 2 - 60;
  const boxLeft = (screenWidth - boxSize) / 2;

  const getBoxBorderStyle = () => {
    switch (boxState) {
      case 'MATCH':
        return styles.guideBoxMatch;
      case 'IDENTIFIED':
        return styles.guideBoxIdentified;
      case 'ALIGNED':
        return isIdentified ? styles.guideBoxIdentified : styles.guideBoxAligned;
      case 'WARNING':
        return styles.guideBoxWarning;
      default:
        return styles.guideBoxDefault;
    }
  };

  const getPillStyle = () => {
    switch (boxState) {
      case 'MATCH':
        return styles.pillMatch;
      case 'IDENTIFIED':
        return styles.pillIdentified;
      case 'WARNING':
        return styles.pillWarning;
      case 'ALIGNED':
        return isIdentified ? styles.pillIdentified : styles.pillAligned;
      default:
        return styles.pillDefault;
    }
  };

  return (
    <>
      {/* Floating Status / Guidance Pill at Top */}
      <View style={styles.pillContainer} pointerEvents="none">
        <View style={[styles.pill, getPillStyle()]}>
          <Text style={styles.pillText}>{promptText}</Text>
        </View>
      </View>

      {/* Centered Guide Box Overlay at Exact Screen Center */}
      <View
        style={[
          styles.guideBox,
          getBoxBorderStyle(),
          {
            top: boxTop,
            left: boxLeft,
            width: boxSize,
            height: boxSize,
          },
        ]}
        pointerEvents="none">
        {subText ? <Text style={styles.subText}>{subText}</Text> : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    position: 'absolute',
    top: 52,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  pillDefault: {
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderColor: '#475569',
  },
  pillAligned: {
    backgroundColor: 'rgba(120, 53, 15, 0.92)',
    borderColor: '#f59e0b',
  },
  pillIdentified: {
    backgroundColor: 'rgba(3, 105, 161, 0.94)',
    borderColor: '#38bdf8',
  },
  pillMatch: {
    backgroundColor: 'rgba(22, 101, 52, 0.95)',
    borderColor: '#22c55e',
  },
  pillWarning: {
    backgroundColor: 'rgba(153, 27, 27, 0.92)',
    borderColor: '#ef4444',
  },
  pillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  guideBox: {
    position: 'absolute',
    borderRadius: 28,
    borderWidth: 2.5,
  },
  guideBoxDefault: {
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  guideBoxAligned: {
    borderColor: '#f59e0b',
    borderWidth: 3,
  },
  guideBoxIdentified: {
    borderColor: '#38bdf8',
    borderWidth: 3.5,
  },
  guideBoxMatch: {
    borderColor: '#22c55e',
    borderWidth: 4,
  },
  guideBoxWarning: {
    borderColor: '#ef4444',
    borderWidth: 3,
  },
  subText: {
    position: 'absolute',
    bottom: -32,
    alignSelf: 'center',
    width: '120%',
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
