import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('android/app/src/main/AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}. Run expo prebuild first.`);
  process.exit(1);
}

const xml = fs.readFileSync(manifestPath, 'utf8').trimStart();

if (!xml.startsWith('<manifest')) {
  console.error(
    'AndroidManifest.xml must start with <manifest>. ' +
      'A config plugin may have added an invalid wrapper element (for example <root>).',
  );
  process.exit(1);
}

if (/<root[\s>]/i.test(xml)) {
  console.error(
    'AndroidManifest.xml contains an invalid <root> wrapper. ' +
      'Use AndroidConfig.Manifest.ensureToolsAvailable() in config plugins.',
  );
  process.exit(1);
}

const blockedOrientation = /android:screenOrientation\s*=\s*"(portrait|landscape|sensorPortrait|sensorLandscape|userPortrait|userLandscape)"/i;
if (blockedOrientation.test(xml)) {
  console.error(
    'AndroidManifest.xml locks screen orientation. Large-screen Play checks require removing android:screenOrientation.',
  );
  process.exit(1);
}

if (/PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY/.test(xml)) {
  console.error(
    'AndroidManifest.xml opts out of large-screen resizability. Remove PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY.',
  );
  process.exit(1);
}

const mainActivity = xml.match(/<activity[^>]*android:name="[^"]*MainActivity"[^>]*>/);
if (mainActivity && !/android:resizeableActivity\s*=\s*"true"/.test(mainActivity[0])) {
  console.error('MainActivity must declare android:resizeableActivity="true".');
  process.exit(1);
}

console.log('AndroidManifest.xml structure looks valid.');
