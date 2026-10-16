import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {loadTensorflowModel} from 'react-native-fast-tflite';

const INPUT_SIZE = 3 * 112 * 112; // 37632
const EMBEDDING_SIZE = 128;

export default function FaceModelTest() {
  const [status, setStatus] = useState('Loading MobileFaceNet...');
  const [details, setDetails] = useState('');

  useEffect(() => {
    let mounted = true;

    const testModel = async () => {
      try {
        const model = await loadTensorflowModel(
          require('./assets/models/mobile_facenet.tflite'),
          [],
        );

        console.log('========== MOBILEFACENET ==========');
        console.log('INPUT TENSORS:', model.inputs);
        console.log('OUTPUT TENSORS:', model.outputs);

        // Model expects:
        // img1 -> [1, 3, 112, 112]
        // img2 -> [1, 3, 112, 112]

        const input1 = new Float32Array(INPUT_SIZE);
        const input2 = new Float32Array(INPUT_SIZE);

        // Deterministic test data.
        // These are NOT face images.
        input1.fill(0.0);
        input2.fill(0.5);

        console.log('INPUT 1 LENGTH:', input1.length);
        console.log('INPUT 2 LENGTH:', input2.length);

        setStatus('Running MobileFaceNet...');

        const outputs = await model.run([
          input1.buffer,
          input2.buffer,
        ]);

        console.log('RAW OUTPUTS:', outputs);
        console.log('OUTPUT COUNT:', outputs.length);

        const output = new Float32Array(outputs[0]);

        console.log('OUTPUT LENGTH:', output.length);
        console.log('FIRST 20 OUTPUT VALUES:', Array.from(output.slice(0, 20)));

        const embedding1 = output.slice(0, EMBEDDING_SIZE);
        const embedding2 = output.slice(
          EMBEDDING_SIZE,
          EMBEDDING_SIZE * 2,
        );

        const allFinite = Array.from(output).every(Number.isFinite);

        console.log('EMBEDDING 1 LENGTH:', embedding1.length);
        console.log('EMBEDDING 2 LENGTH:', embedding2.length);
        console.log('ALL VALUES FINITE:', allFinite);

        if (!mounted) {
          return;
        }

        setStatus(
          allFinite
            ? 'INFERENCE SUCCESSFUL'
            : 'INFERENCE RETURNED INVALID VALUES',
        );

        setDetails(
          `Input 1: ${input1.length} Float32 values\n` +
          `Input 2: ${input2.length} Float32 values\n\n` +
          `Output tensors: ${outputs.length}\n` +
          `Output values: ${output.length}\n\n` +
          `Embedding 1: ${embedding1.length} values\n` +
          `Embedding 2: ${embedding2.length} values\n\n` +
          `Finite values: ${allFinite}\n\n` +
          `First 10 values:\n${Array.from(
            output.slice(0, 10),
          )
            .map(v => v.toFixed(6))
            .join(', ')}`,
        );
      } catch (error) {
        console.error('MOBILEFACENET INFERENCE ERROR:', error);

        if (mounted) {
          setStatus('INFERENCE FAILED');
          setDetails(String(error));
        }
      }
    };

    testModel();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{status}</Text>
      <Text style={styles.details}>{details}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
    justifyContent: 'center',
  },

  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },

  details: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 20,
  },
});