import { FACE_CONFIG } from '../constants/faceConfig.js';

/**
 * Computes L2 magnitude of vector and normalizes it in-place or returns new float array.
 * @param {Float32Array | number[]} vec 
 * @returns {Float32Array} Normalized unit vector
 */
export function normalizeVector(vec) {
  const size = vec.length;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    sumSq += vec[i] * vec[i];
  }
  const magnitude = Math.max(Math.sqrt(sumSq), FACE_CONFIG.NORMALIZATION_EPSILON);
  const normalized = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    normalized[i] = vec[i] / magnitude;
  }
  return normalized;
}

/**
 * Calculates Cosine Similarity (Dot product of two unit vectors).
 * Result range: -1.0 to +1.0
 * @param {Float32Array | number[]} vecA 
 * @param {Float32Array | number[]} vecB 
 * @returns {number}
 */
export function cosineSimilarity(vecA, vecB) {
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * Averages multiple sample vectors gathered during enrollment and normalizes the result.
 * @param {Array<Float32Array | number[]>} samples
 * @param {number} embeddingSize
 * @returns {number[]} Array of normalized floats rounded to 6 decimal places
 */
export function averageEmbeddings(samples, embeddingSize = FACE_CONFIG.EMBEDDING_SIZE) {
  if (!samples || samples.length === 0) return [];

  const count = samples.length;
  const averaged = new Float32Array(embeddingSize);

  // Sum element-wise
  for (let s = 0; s < count; s++) {
    const sample = samples[s];
    for (let i = 0; i < embeddingSize; i++) {
      averaged[i] += sample[i];
    }
  }

  // Calculate mean and L2 norm
  let sumSq = 0;
  for (let i = 0; i < embeddingSize; i++) {
    averaged[i] /= count;
    sumSq += averaged[i] * averaged[i];
  }

  const magnitude = Math.max(Math.sqrt(sumSq), FACE_CONFIG.NORMALIZATION_EPSILON);
  const finalVector = new Array(embeddingSize);

  for (let i = 0; i < embeddingSize; i++) {
    finalVector[i] = Number((averaged[i] / magnitude).toFixed(6));
  }

  return finalVector;
}

/**
 * Fast 1:N Face Search & Verification against locally enrolled employee database.
 * @param {Float32Array | number[]} liveVector - Live normalized embedding from camera
 * @param {Array} employeeList - List of employees with valid template
 * @param {number} threshold - Match threshold (e.g. 0.70)
 * @returns {{ bestMatch: object | null, similarityScore: number, isMatch: boolean }}
 */
export function findBestFaceMatch(liveVector, employeeList, threshold = FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD) {
  if (!liveVector || !employeeList || employeeList.length === 0) {
    return { bestMatch: null, similarityScore: 0, isMatch: false };
  }

  const vecLen = liveVector.length;
  let bestMatch = null;
  let highestScore = -1;

  for (let i = 0; i < employeeList.length; i++) {
    const emp = employeeList[i];
    const template = emp.template || emp.face_embedding;
    if (!template || template.length < vecLen) continue;

    let dot = 0;
    for (let j = 0; j < vecLen; j++) {
      dot += liveVector[j] * template[j];
    }

    if (dot > highestScore) {
      highestScore = dot;
      bestMatch = emp;
    }
  }

  const isMatch = highestScore >= threshold && bestMatch !== null;

  return {
    bestMatch: isMatch ? bestMatch : null,
    candidateMatch: bestMatch, // Available for debug or near-match display
    similarityScore: Math.max(0, highestScore),
    isMatch,
  };
}

/**
 * Validates face bounding, presence and orientation
 * @param {Array} faces - Faces array from MLKit face detector
 * @param {number} maxYaw - Maximum allowed head rotation angle
 * @returns {{ isValid: boolean, status: string, face: object | null }}
 */
export function validateFacePose(faces, maxYaw = FACE_CONFIG.MAX_HEAD_YAW_DEGREES) {
  if (!Array.isArray(faces) || faces.length === 0) {
    return { isValid: false, status: 'NO_FACE', message: 'Position Face in Box', face: null };
  }

  if (faces.length > 1) {
    return { isValid: false, status: 'MULTIPLE_FACES', message: 'Only 1 person in frame', face: null };
  }

  const face = faces[0];
  const yaw = typeof face.yawAngle === 'number' ? face.yawAngle : 0;

  if (Math.abs(yaw) > maxYaw) {
    const dir = yaw > maxYaw ? 'Left' : 'Right';
    return { isValid: false, status: 'HEAD_TURNED', message: `Turn ${dir} toward Camera`, face };
  }

  return { isValid: true, status: 'VALID_FACE', message: 'Face Detected', face };
}
