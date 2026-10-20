import { FACE_CONFIG } from '../constants/faceConfig.js';

/**
 * Computes L2 magnitude of vector and normalizes it to unit length 1.0.
 * @param {Float32Array | number[]} vec - 512-D vector
 * @returns {Float32Array} Normalized unit vector
 */
export function normalizeVector(vec) {
  const size = vec.length;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    sumSq += vec[i] * vec[i];
  }
  const magnitude = Math.max(Math.sqrt(sumSq), FACE_CONFIG.NORMALIZATION_EPSILON || 1e-12);
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
 * @param {number} embeddingSize - defaults to 512
 * @returns {number[]} Array of normalized floats rounded to 6 decimal places
 */
export function averageEmbeddings(samples, embeddingSize = FACE_CONFIG.EMBEDDING_SIZE || 512) {
  if (!samples || samples.length === 0) return [];

  const count = samples.length;
  const averaged = new Float32Array(embeddingSize);

  // Element-wise sum of enrollment samples
  for (let s = 0; s < count; s++) {
    const sample = samples[s];
    for (let i = 0; i < embeddingSize; i++) {
      averaged[i] += sample[i];
    }
  }

  // Divide by count and compute sum of squares for L2 norm
  let sumSq = 0;
  for (let i = 0; i < embeddingSize; i++) {
    averaged[i] /= count;
    sumSq += averaged[i] * averaged[i];
  }

  const magnitude = Math.max(Math.sqrt(sumSq), FACE_CONFIG.NORMALIZATION_EPSILON || 1e-12);
  const finalVector = new Array(embeddingSize);

  for (let i = 0; i < embeddingSize; i++) {
    finalVector[i] = Number((averaged[i] / magnitude).toFixed(6));
  }

  return finalVector;
}

/**
 * Fast 1:N Face Search & Verification against locally enrolled employee database.
 * Requires both minimum threshold (>= 0.78) AND a confidence margin (>= 0.08)
 * above the 2nd best match to prevent misidentifying Person A as Person B.
 *
 * @param {Float32Array | number[]} liveVector - Live normalized 512-D embedding from camera
 * @param {Array} employeeList - List of employees with valid template
 * @param {number} threshold - Match threshold (default 0.78)
 * @param {number} minMargin - Required margin between #1 and #2 candidate (default 0.08)
 * @returns {{ bestMatch: object | null, candidateMatch: object | null, similarityScore: number, secondScore: number, secondMatch: object | null, isMatch: boolean, isAmbiguous: boolean }}
 */
export function findBestFaceMatch(
  liveVector,
  employeeList,
  threshold = FACE_CONFIG.DEFAULT_SIMILARITY_THRESHOLD || 0.78,
  minMargin = FACE_CONFIG.MIN_MATCH_MARGIN || 0.08,
) {
  if (!liveVector || !employeeList || employeeList.length === 0) {
    return {
      bestMatch: null,
      candidateMatch: null,
      similarityScore: 0,
      secondScore: 0,
      secondMatch: null,
      isMatch: false,
      isAmbiguous: false,
    };
  }

  const vecLen = liveVector.length;
  let bestMatch = null;
  let highestScore = -1;
  let secondMatch = null;
  let secondHighestScore = -1;

  for (let i = 0; i < employeeList.length; i++) {
    const emp = employeeList[i];
    const template = emp.template || emp.face_embedding;
    if (!template || template.length < vecLen) continue;

    let dot = 0;
    for (let j = 0; j < vecLen; j++) {
      dot += liveVector[j] * template[j];
    }

    if (dot > highestScore) {
      secondHighestScore = highestScore;
      secondMatch = bestMatch;
      highestScore = dot;
      bestMatch = emp;
    } else if (dot > secondHighestScore) {
      secondHighestScore = dot;
      secondMatch = emp;
    }
  }

  const targetThreshold = threshold ?? 0.78;
  const targetMargin = minMargin ?? 0.08;

  const meetsThreshold = highestScore >= targetThreshold && bestMatch !== null;

  // Margin check: If there are multiple enrolled profiles, the top match must be distinctly
  // higher than the 2nd best match to avoid confusing two similar faces.
  let isAmbiguous = false;
  if (meetsThreshold && employeeList.length > 1 && secondHighestScore > 0) {
    const margin = highestScore - secondHighestScore;
    if (margin < targetMargin) {
      isAmbiguous = true;
    }
  }

  const isMatch = meetsThreshold && !isAmbiguous;

  return {
    bestMatch: isMatch ? bestMatch : null,
    candidateMatch: bestMatch,
    similarityScore: Math.max(0, highestScore),
    secondScore: Math.max(0, secondHighestScore),
    secondMatch,
    isMatch,
    isAmbiguous,
  };
}

/**
 * Validates face bounding, presence, pose gates (pitch, roll, yaw), and minimum bounding box size
 * to reject distorted or distant frames before neural inference.
 *
 * @param {Array} faces - Faces array from MLKit face detector
 * @param {number | object} optionsOrYaw - Maximum allowed head rotation angle or options object
 * @returns {{ isValid: boolean, status: string, message: string, face: object | null }}
 */
export function validateFacePose(faces, optionsOrYaw = FACE_CONFIG.MAX_HEAD_YAW_DEGREES) {
  if (!Array.isArray(faces) || faces.length === 0) {
    return { isValid: false, status: 'NO_FACE', message: 'Position Face in Box', face: null };
  }

  if (faces.length > 1) {
    return { isValid: false, status: 'MULTIPLE_FACES', message: 'Only 1 person in frame', face: null };
  }

  const face = faces[0];

  const opts = typeof optionsOrYaw === 'number' ? { maxYaw: optionsOrYaw } : optionsOrYaw || {};
  const maxYaw = opts.maxYaw ?? FACE_CONFIG.MAX_HEAD_YAW_DEGREES ?? 18;
  const maxPitch = opts.maxPitch ?? FACE_CONFIG.MAX_HEAD_PITCH_DEGREES ?? 14;
  const maxRoll = opts.maxRoll ?? FACE_CONFIG.MAX_HEAD_ROLL_DEGREES ?? 10;
  const minBoxSize = opts.minBoxSize ?? FACE_CONFIG.MIN_FACE_BOX_SIZE ?? 120;

  const yaw = typeof face.yawAngle === 'number' ? face.yawAngle : typeof face.yaw === 'number' ? face.yaw : 0;
  const pitch = typeof face.pitchAngle === 'number' ? face.pitchAngle : typeof face.pitch === 'number' ? face.pitch : 0;
  const roll = typeof face.rollAngle === 'number' ? face.rollAngle : typeof face.roll === 'number' ? face.roll : 0;

  // 1. Yaw gate (Head turned left/right)
  if (Math.abs(yaw) > maxYaw) {
    const dir = yaw > maxYaw ? 'Left' : 'Right';
    return { isValid: false, status: 'HEAD_TURNED', message: `Turn ${dir} toward Camera`, face };
  }

  // 2. Pitch gate (Head tilted up/down)
  if (Math.abs(pitch) > maxPitch) {
    const dir = pitch > maxPitch ? 'Down' : 'Up';
    return { isValid: false, status: 'HEAD_TILTED', message: `Tilt Head ${dir}`, face };
  }

  // 3. Roll gate (Head tilted sideways)
  if (Math.abs(roll) > maxRoll) {
    return { isValid: false, status: 'HEAD_ROLLED', message: 'Keep Head Straight', face };
  }

  // 4. Minimum bounding box size gate (Reject distant faces)
  const boxWidth = face.bounds?.width ?? face.bounds?.size?.width ?? face.boundingBox?.width ?? 0;
  const boxHeight = face.bounds?.height ?? face.bounds?.size?.height ?? face.boundingBox?.height ?? 0;

  if (boxWidth > 0 && boxHeight > 0) {
    if (boxWidth < minBoxSize || boxHeight < minBoxSize) {
      return { isValid: false, status: 'TOO_FAR', message: 'Move Closer to Camera', face };
    }
  }

  return { isValid: true, status: 'VALID_FACE', message: 'Face Detected', face };
}

/**
 * Verifies whether a face embedding matches another existing employee in the database.
 * Used during Face Enrollment & Update to prevent the same physical person from enrolling
 * or updating under multiple employee profiles.
 *
 * @param {Float32Array | number[]} newEmbedding - Newly captured 512-D face embedding
 * @param {Array<object>} allEmployees - Full list of employees
 * @param {string | number} currentEmployeeId - ID of employee currently being enrolled/updated
 * @param {number} [duplicateThreshold] - Similarity threshold to consider as duplicate (default 0.75)
 * @returns {{ isDuplicate: boolean, existingEmployee: object | null, similarity: number }}
 */
export function checkForDuplicateFace(
  newEmbedding,
  allEmployees,
  currentEmployeeId,
  currentEmployeeCode = null,
  duplicateThreshold = FACE_CONFIG.DUPLICATE_FACE_THRESHOLD || 0.75,
) {
  if (!newEmbedding || !Array.isArray(allEmployees) || allEmployees.length === 0) {
    return { isDuplicate: false, existingEmployee: null, similarity: 0 };
  }

  const vecLen = newEmbedding.length;
  let highestDuplicateScore = -1;
  let duplicateEmployee = null;
  let overallMaxScore = -1;

  for (let i = 0; i < allEmployees.length; i++) {
    const emp = allEmployees[i];

    // Exclude the current employee (self-update is allowed)
    const isSameId = currentEmployeeId != null && String(emp.id) === String(currentEmployeeId);
    const isSameCode =
      currentEmployeeCode &&
      emp.code &&
      String(emp.code).trim().toLowerCase() === String(currentEmployeeCode).trim().toLowerCase();

    if (isSameId || isSameCode) {
      continue;
    }

    const template = emp.template || emp.face_embedding;
    if (!template || template.length < vecLen) {
      continue;
    }

    let dot = 0;
    for (let j = 0; j < vecLen; j++) {
      dot += newEmbedding[j] * template[j];
    }

    if (dot > overallMaxScore) {
      overallMaxScore = dot;
    }

    if (dot >= duplicateThreshold && dot > highestDuplicateScore) {
      highestDuplicateScore = dot;
      duplicateEmployee = emp;
    }
  }

  return {
    isDuplicate: duplicateEmployee !== null,
    existingEmployee: duplicateEmployee,
    similarity: duplicateEmployee !== null ? highestDuplicateScore : Math.max(0, overallMaxScore),
  };
}

