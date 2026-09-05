import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  path.join(root, 'node_modules/@react-native-voice/voice/android/build.gradle'),
  path.join(root, '..', 'node_modules/@react-native-voice/voice/android/build.gradle'),
  path.join(root, 'node_modules/@react-native-voice/voice/android/build.gradle.kts'),
];

for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('com.android.support:appcompat-v7')) continue;
  content = content.replace(
    /implementation "com\.android\.support:appcompat-v7:\$\{supportVersion\}"/,
    'implementation "androidx.appcompat:appcompat:1.7.0"',
  );
  fs.writeFileSync(file, content);
  console.log('[patch-voice-android] updated', file);
}
