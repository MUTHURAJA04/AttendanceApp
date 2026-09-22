import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
} from 'react-native-vision-camera';

import {useResizer} from 'react-native-vision-camera-resizer';
import {useTensorflowModel} from 'react-native-fast-tflite';

const MODEL_INPUT_WIDTH = 112;
const MODEL_INPUT_HEIGHT = 112;
const EMBEDDING_SIZE = 128;
const NORMALIZATION_EPSILON = 1e-12;

export default function FaceRecognitionCamera() {
  const device = useCameraDevice('front');

  const {hasPermission, requestPermission} =
    useCameraPermission();

  // -----------------------------------------
  // MOBILEFACENET
  // -----------------------------------------

  const modelPlugin = useTensorflowModel(
    require('./assets/models/mobile_facenet.tflite'),
    [],
  );

  const model =
    modelPlugin.state === 'loaded'
      ? modelPlugin.model
      : null;

  // -----------------------------------------
  // UI STATE
  // -----------------------------------------

  const [status, setStatus] =
    useState('Loading MobileFaceNet...');

  const [embeddingInfo, setEmbeddingInfo] =
    useState('Waiting for camera frame...');

  // -----------------------------------------
  // CAMERA PERMISSION
  // -----------------------------------------

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // -----------------------------------------
  // RESIZER
  //
  // Model:
  // [1, 3, 112, 112]
  //
  // RGB
  // Float32
  // Planar / CHW
  // -----------------------------------------

  const {resizer, error: resizerError} =
    useResizer({
      width: MODEL_INPUT_WIDTH,
      height: MODEL_INPUT_HEIGHT,
      channelOrder: 'rgb',
      dataType: 'float32',
      pixelLayout: 'planar',
      scaleMode: 'cover',
    });

  // -----------------------------------------
  // MODEL STATUS
  // -----------------------------------------

  useEffect(() => {
    if (modelPlugin.state === 'loading') {
      setStatus('Loading MobileFaceNet...');
      return;
    }

    if (modelPlugin.state === 'loaded') {
      console.log(
        '========== MOBILEFACENET ==========',
      );

      console.log(
        'INPUTS:',
        modelPlugin.model.inputs,
      );

      console.log(
        'OUTPUTS:',
        modelPlugin.model.outputs,
      );

      console.log(
        '====================================',
      );

      setStatus('MobileFaceNet ready');
      return;
    }

    if (modelPlugin.state === 'error') {
      console.error(
        'MOBILEFACENET LOAD ERROR:',
        modelPlugin.error,
      );

      setStatus('MobileFaceNet load failed');
    }
  }, [
    modelPlugin.state,
    modelPlugin.model,
    modelPlugin.error,
  ]);

  // -----------------------------------------
  // RESIZER ERROR
  // -----------------------------------------

  useEffect(() => {
    if (resizerError) {
      console.error(
        'RESIZER ERROR:',
        resizerError,
      );

      setEmbeddingInfo(
        `Resizer error: ${String(resizerError)}`,
      );
    }
  }, [resizerError]);

  // -----------------------------------------
  // FRAME OUTPUT
  // -----------------------------------------

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',

    onFrame(frame) {
      'worklet';

      if (model == null || resizer == null) {
        frame.dispose();
        return;
      }

      try {
        // -------------------------------------
        // Resize camera frame
        // -------------------------------------

        const resized = resizer.resize(frame);

        try {
          // -----------------------------------
          // Get 112x112 RGB float32 planar data
          // -----------------------------------

          const buffer =
            resized.getPixelBuffer();

          // -----------------------------------
          // Run MobileFaceNet
          // -----------------------------------

          const modelInputs =
            model.inputs.length === 2
              ? [buffer, buffer]
              : [buffer];

          const outputs =
            model.runSync(modelInputs);

          if (
            !outputs ||
            outputs.length === 0
          ) {
            return;
          }

          // -----------------------------------
          // First output tensor
          // -----------------------------------

          const output =
            new Float32Array(outputs[0]);

          // -----------------------------------
          // Verify output size
          // -----------------------------------

          if (
            output.length <
            EMBEDDING_SIZE
          ) {
            console.log(
              'INVALID EMBEDDING SIZE:',
              output.length,
            );

            return;
          }

          const embedding =
            output.slice(
              0,
              EMBEDDING_SIZE,
            );

          // -----------------------------------
          // Validate raw embedding
          // -----------------------------------

          let allFinite = true;
          let sumSquares = 0;

          for (
            let i = 0;
            i < embedding.length;
            i++
          ) {
            const value = embedding[i];

            if (!Number.isFinite(value)) {
              allFinite = false;
              break;
            }

            sumSquares += value * value;
          }

          if (!allFinite) {
            console.log(
              'INVALID EMBEDDING: non-finite value',
            );

            return;
          }

          const rawMagnitude =
            Math.sqrt(sumSquares);

          // -----------------------------------
          // L2 NORMALIZATION
          // -----------------------------------

          const normalizedEmbedding =
            new Float32Array(
              EMBEDDING_SIZE,
            );

          const safeMagnitude =
            Math.max(
              rawMagnitude,
              NORMALIZATION_EPSILON,
            );

          for (
            let i = 0;
            i < EMBEDDING_SIZE;
            i++
          ) {
            normalizedEmbedding[i] =
              embedding[i] /
              safeMagnitude;
          }

          // -----------------------------------
          // Verify normalized magnitude
          // -----------------------------------

          let normalizedSumSquares = 0;

          for (
            let i = 0;
            i < normalizedEmbedding.length;
            i++
          ) {
            const value =
              normalizedEmbedding[i];

            normalizedSumSquares +=
              value * value;
          }

          const normalizedMagnitude =
            Math.sqrt(
              normalizedSumSquares,
            );

          // -----------------------------------
          // DEBUG
          // -----------------------------------

          console.log(
            '========== FACE EMBEDDING ==========',
          );

          console.log(
            'INPUT:',
            '112 x 112 RGB float32 planar',
          );

          console.log(
            'OUTPUT COUNT:',
            outputs.length,
          );

          console.log(
            'EMBEDDING SIZE:',
            embedding.length,
          );

          console.log(
            'ALL FINITE:',
            allFinite,
          );

          console.log(
            'RAW MAGNITUDE:',
            rawMagnitude,
          );

          console.log(
            'NORMALIZED MAGNITUDE:',
            normalizedMagnitude,
          );

          console.log(
            'RAW FIRST 10:',
            Array.from(
              embedding.slice(0, 10),
            ),
          );

          console.log(
            'NORMALIZED FIRST 10:',
            Array.from(
              normalizedEmbedding.slice(0, 10),
            ),
          );

          console.log(
            '====================================',
          );
        } finally {
          resized.dispose();
        }
      } catch (error) {
        console.error(
          'FACE EMBEDDING ERROR:',
          error,
        );
      } finally {
        frame.dispose();
      }
    },
  });

  // -----------------------------------------
  // PERMISSION
  // -----------------------------------------

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Camera permission required
        </Text>
      </View>
    );
  }

  // -----------------------------------------
  // DEVICE
  // -----------------------------------------

  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Front camera not available
        </Text>
      </View>
    );
  }

  // -----------------------------------------
  // CAMERA
  // -----------------------------------------

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[frameOutput]}
      />

      <View style={styles.overlay}>
        <Text style={styles.title}>
          MobileFaceNet
        </Text>

        <Text style={styles.status}>
          {status}
        </Text>

        <Text style={styles.info}>
          112 × 112
        </Text>

        <Text style={styles.info}>
          RGB / Float32 / Planar
        </Text>

        <Text style={styles.info}>
          Expected embedding: 128 values
        </Text>

        <Text style={styles.embedding}>
          {embeddingInfo}
        </Text>
      </View>
    </View>
  );
}

// -----------------------------------------
// STYLES
// -----------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  text: {
    color: '#fff',
    fontSize: 18,
  },

  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 40,
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },

  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },

  status: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },

  info: {
    color: '#ddd',
    fontSize: 14,
    marginTop: 3,
  },

  embedding: {
    color: '#aaa',
    fontSize: 13,
    marginTop: 10,
  },
});