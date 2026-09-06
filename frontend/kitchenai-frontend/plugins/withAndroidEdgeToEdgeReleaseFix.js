/**
 * Play Console compliance for Android 15+:
 * 1. Edge-to-edge — strip deprecated status/navigation bar theme attrs and Compose PreviewActivity
 * 2. Large screens — ensure activities are resizable and not orientation-locked in the manifest
 */
const {
  withAndroidManifest,
  withAndroidStyles,
  withAppBuildGradle,
  withProjectBuildGradle,
  AndroidConfig,
} = require('expo/config-plugins');

const MARKER = '// @rasoibuddy edge-to-edge release fixes';
const PREVIEW_ACTIVITY = 'androidx.compose.ui.tooling.PreviewActivity';

/** Theme attrs that map to deprecated Window.setStatusBarColor / setNavigationBarColor. */
const DEPRECATED_THEME_ITEMS = [
  'android:statusBarColor',
  'android:navigationBarColor',
  'android:windowTranslucentStatus',
  'android:windowTranslucentNavigation',
  'android:windowOptOutEdgeToEdgeEnforcement',
];

const ORIENTATION_ATTRS = [
  'android:screenOrientation',
  'android:maxAspectRatio',
  'android:minAspectRatio',
];

function isMainActivity(name) {
  return name === '.MainActivity' || name === 'MainActivity' || name?.endsWith('.MainActivity');
}

function stripDeprecatedStyles(styles) {
  let next = styles;
  const parent = AndroidConfig.Styles.getAppThemeGroup();
  for (const name of DEPRECATED_THEME_ITEMS) {
    next = AndroidConfig.Styles.removeStylesItem({ xml: next, parent, name });
  }
  if (next.resources?.style) {
    for (const styleGroup of next.resources.style) {
      if (!Array.isArray(styleGroup.item)) continue;
      styleGroup.item = styleGroup.item.filter(
        (item) => !DEPRECATED_THEME_ITEMS.includes(item.$?.name),
      );
    }
  }
  return next;
}

function withEdgeToEdgeReleaseFix(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      return cfg;
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    const snippet = `
${MARKER}
gradle.projectsLoaded {
  rootProject.subprojects { subproject ->
    subproject.afterEvaluate {
      subproject.configurations.configureEach { configuration ->
        if (configuration.name.toLowerCase().contains('release')) {
          configuration.exclude group: 'androidx.compose.ui', module: 'ui-tooling'
        }
      }
    }
  }
}
`;
    cfg.modResults.contents += snippet;
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      return cfg;
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg;
    }
    const snippet = `
    ${MARKER}
    configurations.configureEach {
      if (it.name.toLowerCase().contains('release')) {
        exclude group: 'androidx.compose.ui', module: 'ui-tooling'
      }
    }
`;
    cfg.modResults.contents = cfg.modResults.contents.replace(/^android\s*\{/m, `android {${snippet}`);
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    const activities = app.activity ?? [];
    const already = activities.some(
      (entry) => entry?.$?.['android:name'] === PREVIEW_ACTIVITY,
    );
    if (!already) {
      app.activity = [
        ...activities,
        {
          $: {
            'android:name': PREVIEW_ACTIVITY,
            'tools:node': 'remove',
          },
        },
      ];
    }

    for (const activity of app.activity ?? []) {
      if (!activity?.$) continue;
      const name = activity.$['android:name'];
      if (!isMainActivity(name)) continue;
      activity.$['android:resizeableActivity'] = 'true';
      for (const attr of ORIENTATION_ATTRS) {
        delete activity.$[attr];
      }
    }

    for (const activity of app.activity ?? []) {
      if (!activity?.$) continue;
      for (const attr of ORIENTATION_ATTRS) {
        delete activity.$[attr];
      }
    }

    const properties = app.property ?? [];
    const blocked = 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY';
    app.property = properties.filter((entry) => entry?.$?.['android:name'] !== blocked);

    cfg.modResults = manifest;
    return cfg;
  });

  config = withAndroidStyles(config, (cfg) => {
    cfg.modResults = stripDeprecatedStyles(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withEdgeToEdgeReleaseFix;
