import React from 'react';
import ScrfdFaceGuideHUD from './ScrfdFaceGuideHUD';

/**
 * Reusable Face Alignment Guide Box with SCRFD Target Oval HUD & 5-Keypoint Biometric Dots
 * 
 * Backwards-compatible wrapper around ScrfdFaceGuideHUD providing:
 * - Dynamic 3-state Target Oval HUD (Neutral, Tracking/Centered, Verified Flash)
 * - 5 Live Pulsating Biometric Landmark Dots (Eyes, Nose, Mouth corners)
 * - Multi-Face Warning Banner
 * - Top guidance status pill
 * 
 * @param {object} props
 * @param {'DEFAULT' | 'ALIGNED' | 'IDENTIFIED' | 'MATCH' | 'WARNING'} [props.boxState='DEFAULT']
 * @param {string} [props.promptText='Position Face in Box']
 * @param {string} [props.subText='Keep face steady inside frame']
 * @param {boolean} [props.isIdentified=false]
 * @param {boolean} [props.isLoading=false]
 * @param {object | Array} [props.landmarks=null]
 * @param {boolean} [props.multipleFacesDetected=false]
 * @param {boolean} [props.showLandmarks=true]
 */
export default function FaceGuideBox(props) {
  return <ScrfdFaceGuideHUD {...props} />;
}
