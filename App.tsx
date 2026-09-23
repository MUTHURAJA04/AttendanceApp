// import React, {useState} from 'react';
// import {StyleSheet, Text, View} from 'react-native';
// import FaceDetectionCamera from './FaceDetectionCamera';

// export default function App() {
//   const [livenessVerified, setLivenessVerified] = useState(false);

//   const handleLivenessVerified = () => {
//     setLivenessVerified(true);

//     console.log('🎉 APP: LIVENESS VERIFIED');
//   };

//   return (
//     <View style={styles.container}>
//       <FaceDetectionCamera
//         onLivenessVerified={handleLivenessVerified}
//       />

//       {livenessVerified && (
//         <View style={styles.successBox}>
//           <Text style={styles.successText}>
//             Liveness Verified
//           </Text>

//           <Text style={styles.successSubText}>
//             Ready for face verification
//           </Text>
//         </View>
//       )}
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#000',
//   },

//   successBox: {
//     position: 'absolute',
//     bottom: 50,
//     left: 20,
//     right: 20,
//     paddingVertical: 18,
//     paddingHorizontal: 20,
//     borderRadius: 14,
//     backgroundColor: '#166534',
//     alignItems: 'center',
//   },

//   successText: {
//     color: '#fff',
//     fontSize: 20,
//     fontWeight: '700',
//   },

//   successSubText: {
//     color: '#dcfce7',
//     fontSize: 14,
//     marginTop: 5,
//   },
// });

import React from 'react';
import UnifiedAttendanceCamera from './UnifiedAttendanceCamera';
import FaceRecognitionCamera from './FaceRecognitionCamera.jsx';

export default function App() {
  // return <FaceModelTest />;
   return <UnifiedAttendanceCamera/>
}