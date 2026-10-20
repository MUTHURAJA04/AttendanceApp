/**
 * SCRFD 2.5G Face Detection & Alignment Service
 * 
 * Features:
 * 1. Model assets & configuration for scrfd_2.5g_bnkps.onnx
 * 2. 640x640 preprocessing with (pixel - 127.5) / 128.0 normalization
 * 3. 9-tensor decoding across strides 8, 16, 32:
 *    - Scores: 446, 466, 486
 *    - Bboxes: 449, 469, 489
 *    - 5 Keypoints: 452, 472, 492 (Left Eye, Right Eye, Nose tip, Left Mouth, Right Mouth)
 * 4. Non-Maximum Suppression (NMS)
 * 5. Umeyama 5-point Similarity / Affine Transformation to 112x112 ArcFace canonical reference
 * 6. Oval centering & steady-pose verification
 */

export const SCRFD_CONFIG = {
  MODEL_NAME: 'scrfd_2.5g_bnkps.onnx',
  MODEL_PATH: 'assets/models/scrfd_2.5g_bnkps.onnx',
  INPUT_WIDTH: 640,
  INPUT_HEIGHT: 640,
  NORM_MEAN: 127.5,
  NORM_STD: 128.0,
  SCORE_THRESHOLD: 0.50,
  NMS_IOU_THRESHOLD: 0.40,
  STRIDES: [8, 16, 32],
  NUM_ANCHORS_PER_CELL: 2,
  STEADY_TIME_MS: 300,
  STEADY_DISPLACEMENT_PX: 18,
};

// Canonical 112x112 5-point ArcFace / InsightFace landmark template
export const ARCFACE_CANONICAL_112 = [
  [38.2946, 51.6963], // 1. Left Eye
  [73.5318, 51.5014], // 2. Right Eye
  [56.0252, 71.7366], // 3. Nose tip
  [41.5493, 92.3655], // 4. Left Mouth corner
  [70.7299, 92.2041], // 5. Right Mouth corner
];

let cachedAnchors = null;

/**
 * Generate pre-computed anchor centers for 640x640 input resolution across strides 8, 16, 32
 * Total anchors: 12,800 + 3,200 + 800 = 16,800 anchors
 */
export function getScrfdAnchors(inputW = SCRFD_CONFIG.INPUT_WIDTH, inputH = SCRFD_CONFIG.INPUT_HEIGHT) {
  if (cachedAnchors && cachedAnchors.width === inputW && cachedAnchors.height === inputH) {
    return cachedAnchors.data;
  }

  const anchorsByStride = {};

  for (const stride of SCRFD_CONFIG.STRIDES) {
    const featW = Math.ceil(inputW / stride);
    const featH = Math.ceil(inputH / stride);
    const anchors = [];

    for (let y = 0; y < featH; y++) {
      for (let x = 0; x < featW; x++) {
        const cx = x * stride;
        const cy = y * stride;
        // 2 anchors per feature map cell in SCRFD 2.5G
        anchors.push([cx, cy]);
        anchors.push([cx, cy]);
      }
    }
    anchorsByStride[stride] = anchors;
  }

  cachedAnchors = { width: inputW, height: inputH, data: anchorsByStride };
  return anchorsByStride;
}

/**
 * Normalize an image pixel buffer for SCRFD: (pixel - 127.5) / 128.0
 * @param {Uint8Array | Uint8ClampedArray} rgbBuffer 
 * @returns {Float32Array}
 */
export function preprocessScrfdFrame(rgbBuffer) {
  const len = rgbBuffer.length;
  const normalized = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    normalized[i] = (rgbBuffer[i] - SCRFD_CONFIG.NORM_MEAN) / SCRFD_CONFIG.NORM_STD;
  }
  return normalized;
}

/**
 * Calculate Intersection over Union (IoU) between two bounding boxes [x1, y1, x2, y2]
 */
export function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA[0], boxB[0]);
  const yA = Math.max(boxA[1], boxB[1]);
  const xB = Math.min(boxA[2], boxB[2]);
  const yB = Math.min(boxA[3], boxB[3]);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  if (interArea <= 0) return 0;

  const boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
  const boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

  return interArea / (boxAArea + boxBArea - interArea);
}

/**
 * Non-Maximum Suppression (NMS) to eliminate duplicate face boxes
 * @param {Array<object>} detections - [{ box: [x1, y1, x2, y2], score, keypoints }]
 * @param {number} iouThreshold
 * @returns {Array<object>} Filtered detections sorted by confidence descending
 */
export function applyNMS(detections, iouThreshold = SCRFD_CONFIG.NMS_IOU_THRESHOLD) {
  if (!detections || detections.length <= 1) return detections || [];

  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const selected = [];

  while (sorted.length > 0) {
    const current = sorted.shift();
    selected.push(current);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = calculateIoU(current.box, sorted[i].box);
      if (iou >= iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return selected;
}

/**
 * Decode SCRFD 9 output tensors:
 * Stride 8: Score (446), Box (449), Keypoints (452)
 * Stride 16: Score (466), Box (469), Keypoints (472)
 * Stride 32: Score (486), Box (489), Keypoints (492)
 */
export function decodeScrfdOutputs(outputs, scoreThreshold = SCRFD_CONFIG.SCORE_THRESHOLD) {
  if (!outputs) return [];

  const anchorsByStride = getScrfdAnchors();
  const rawDetections = [];

  const strideOutputs = [
    { stride: 8, scoreKey: '446', boxKey: '449', kpsKey: '452' },
    { stride: 16, scoreKey: '466', boxKey: '469', kpsKey: '472' },
    { stride: 32, scoreKey: '486', boxKey: '489', kpsKey: '492' },
  ];

  for (const { stride, scoreKey, boxKey, kpsKey } of strideOutputs) {
    const scores = outputs[scoreKey];
    const bboxes = outputs[boxKey];
    const keypoints = outputs[kpsKey];
    const anchors = anchorsByStride[stride];

    if (!scores || !bboxes || !keypoints || !anchors) continue;

    const numAnchors = anchors.length;
    for (let i = 0; i < numAnchors; i++) {
      const score = scores[i];
      if (score < scoreThreshold) continue;

      const [cx, cy] = anchors[i];

      // Decode bounding box offsets: [dx1, dy1, dx2, dy2]
      const dx1 = bboxes[i * 4];
      const dy1 = bboxes[i * 4 + 1];
      const dx2 = bboxes[i * 4 + 2];
      const dy2 = bboxes[i * 4 + 3];

      const x1 = cx - dx1 * stride;
      const y1 = cy - dy1 * stride;
      const x2 = cx + dx2 * stride;
      const y2 = cy + dy2 * stride;

      // Decode 5 keypoints: [leftEye, rightEye, nose, leftMouth, rightMouth]
      const kps = [];
      for (let k = 0; k < 5; k++) {
        const kx = cx + keypoints[i * 10 + k * 2] * stride;
        const ky = cy + keypoints[i * 10 + k * 2 + 1] * stride;
        kps.push([kx, ky]);
      }

      rawDetections.push({
        box: [x1, y1, x2, y2],
        score,
        keypoints: kps,
        stride,
      });
    }
  }

  return applyNMS(rawDetections);
}

/**
 * Standard Umeyama 5-point Similarity / Affine Transformation to 112x112 Canonical Face
 * Computes optimal scale s, rotation theta, and translation [tx, ty] to align
 * live 5 facial keypoints with ArcFace standard input.
 * 
 * @param {Array<[number, number]>} srcPoints - 5 source keypoints [[x,y], ...]
 * @param {Array<[number, number]>} [dstPoints=ARCFACE_CANONICAL_112]
 * @returns {{ scale: number, rotation: number, translation: [number, number], transformMatrix: number[][] }}
 */
export function computeUmeyamaAlignment(srcPoints, dstPoints = ARCFACE_CANONICAL_112) {
  if (!srcPoints || srcPoints.length < 5) {
    return {
      scale: 1.0,
      rotation: 0,
      translation: [0, 0],
      transformMatrix: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    };
  }

  const n = 5;
  let srcMeanX = 0, srcMeanY = 0;
  let dstMeanX = 0, dstMeanY = 0;

  for (let i = 0; i < n; i++) {
    srcMeanX += srcPoints[i][0];
    srcMeanY += srcPoints[i][1];
    dstMeanX += dstPoints[i][0];
    dstMeanY += dstPoints[i][1];
  }
  srcMeanX /= n; srcMeanY /= n;
  dstMeanX /= n; dstMeanY /= n;

  let srcVar = 0;
  let sxx = 0, sxy = 0, syx = 0, syy = 0;

  for (let i = 0; i < n; i++) {
    const sX = srcPoints[i][0] - srcMeanX;
    const sY = srcPoints[i][1] - srcMeanY;
    const dX = dstPoints[i][0] - dstMeanX;
    const dY = dstPoints[i][1] - dstMeanY;

    srcVar += sX * sX + sY * sY;
    sxx += dX * sX;
    sxy += dX * sY;
    syx += dY * sX;
    syy += dY * sY;
  }
  srcVar /= n;
  sxx /= n; sxy /= n; syx /= n; syy /= n;

  // 2D Rotation Angle
  const num = syx - sxy;
  const den = sxx + syy;
  const theta = Math.atan2(num, den);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Scale factor
  const scale = srcVar > 1e-8 ? (cosT * (sxx + syy) + sinT * (syx - sxy)) / srcVar : 1.0;

  // Translation
  const tX = dstMeanX - scale * (cosT * srcMeanX - sinT * srcMeanY);
  const tY = dstMeanY - scale * (sinT * srcMeanX + cosT * srcMeanY);

  return {
    scale,
    rotation: theta,
    translation: [tX, tY],
    transformMatrix: [
      [scale * cosT, -scale * sinT, tX],
      [scale * sinT, scale * cosT, tY],
    ],
  };
}

/**
 * Check if the face bounding box is inside and well-centered within the targeting oval
 * @param {{ x: number, y: number, width: number, height: number }} faceBounds
 * @param {{ centerX: number, centerY: number, radiusX: number, radiusY: number }} oval
 * @returns {{ inside: boolean, centered: boolean, normalizedDistance: number }}
 */
export function checkFaceInsideOval(faceBounds, oval) {
  if (!faceBounds || !oval || oval.radiusX <= 0 || oval.radiusY <= 0) {
    return { inside: false, centered: false, normalizedDistance: 999 };
  }

  const faceCenterX = faceBounds.x + faceBounds.width / 2;
  const faceCenterY = faceBounds.y + faceBounds.height / 2;

  // Elliptical normalized distance formula: ((x - h)/rx)^2 + ((y - k)/ry)^2
  const dx = (faceCenterX - oval.centerX) / oval.radiusX;
  const dy = (faceCenterY - oval.centerY) / oval.radiusY;
  const distSq = dx * dx + dy * dy;

  const inside = distSq <= 1.0;
  const centered = distSq <= 0.35; // tightly centered in inner 35% of oval

  return {
    inside,
    centered,
    normalizedDistance: Math.sqrt(distSq),
  };
}

/**
 * Determine if a face is held steady across frames (within displacement threshold)
 * @param {{ x: number, y: number } | null} prevCenter
 * @param {{ x: number, y: number } | null} currCenter
 * @param {number} thresholdPx
 * @returns {boolean}
 */
export function isFaceSteady(prevCenter, currCenter, thresholdPx = SCRFD_CONFIG.STEADY_DISPLACEMENT_PX) {
  if (!prevCenter || !currCenter) return false;
  const dx = currCenter.x - prevCenter.x;
  const dy = currCenter.y - prevCenter.y;
  return Math.sqrt(dx * dx + dy * dy) <= thresholdPx;
}

export default {
  SCRFD_CONFIG,
  ARCFACE_CANONICAL_112,
  getScrfdAnchors,
  preprocessScrfdFrame,
  calculateIoU,
  applyNMS,
  decodeScrfdOutputs,
  computeUmeyamaAlignment,
  checkFaceInsideOval,
  isFaceSteady,
};
