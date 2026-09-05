import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  TurboModuleRegistry,
} from 'react-native';

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: { length: number; [index: number]: { 0: { transcript: string }; isFinal: boolean } };
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type UseVoiceInputOptions = {
  onResult: (text: string) => void;
  lang?: string;
};

type SpeechResultsPayload = { value?: string[] };
type SpeechErrorPayload = { error?: { code?: string; message?: string } };

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function speechLocaleFromAppLang(language: string): string {
  const base = language.split('-')[0].toLowerCase();
  if (base === 'hi') return 'hi-IN';
  if (base === 'kn') return 'kn-IN';
  return 'en-IN';
}

function speechErrorCode(event: SpeechErrorPayload): string {
  const raw = String(event.error?.code ?? event.error?.message ?? '');
  const slash = raw.split('/')[0]?.trim();
  if (/^\d+$/.test(slash)) return slash;
  const match = raw.match(/^(\d+)\//);
  return match?.[1] ?? '';
}

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(perm)) return true;
  const result = await PermissionsAndroid.request(perm, {
    title: 'Microphone access',
    message: 'Rasoi Buddy needs the microphone so AI Buddy can hear you.',
    buttonPositive: 'Allow',
    buttonNegative: 'Deny',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
  return PermissionsAndroid.check(perm);
}

function voiceStartErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('insufficient') ||
    lower.includes('not authorized')
  ) {
    return 'Microphone permission is required for voice. Enable it in Settings → Apps → Rasoi Buddy → Permissions.';
  }
  if (lower.includes('recognition') || lower.includes('recognizer') || lower.includes('service')) {
    return 'Speech recognition is not available on this device. Install or update the Google app, then try again.';
  }
  if (raw.trim()) return `Voice input failed: ${raw.trim()}`;
  return 'Could not start voice input. Try again.';
}

function getVoiceNativeModule(): { addListener: (eventType: string) => void; removeListeners: (count: number) => void } | null {
  if (Platform.OS === 'web') return null;
  return (
    (TurboModuleRegistry.get('Voice') as { addListener: (eventType: string) => void; removeListeners: (count: number) => void } | null) ??
    (NativeModules.Voice as { addListener: (eventType: string) => void; removeListeners: (count: number) => void } | null) ??
    null
  );
}

export function useVoiceInput({ onResult, lang = 'en-IN' }: UseVoiceInputOptions) {
  const [supported, setSupported] = useState(Platform.OS !== 'web');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [durationSec, setDurationSec] = useState(0);

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const webRecognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const nativeVoiceRef = useRef<{
    start: (locale: string, options?: Record<string, unknown>) => Promise<unknown>;
    stop: () => Promise<unknown>;
    destroy: () => Promise<unknown>;
    cancel?: () => Promise<unknown>;
  } | null>(null);

  const transcriptRef = useRef('');
  const partialRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listeningRef = useRef(false);
  const speechEpochRef = useRef(0);
  const stoppedEpochRef = useRef(0);
  const flushWaitRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(() => {
      setDurationSec((prev) => prev + 1);
    }, 1000);
  }, [clearTimer]);

  const resetSession = useCallback(() => {
    clearTimer();
    transcriptRef.current = '';
    partialRef.current = '';
    setTranscript('');
    setPartialTranscript('');
    setDurationSec(0);
    setListening(false);
    listeningRef.current = false;
    setPaused(false);
    setIsRecording(false);
  }, [clearTimer]);

  const notifyFlushWaiters = useCallback(() => {
    flushWaitRef.current?.();
    flushWaitRef.current = null;
  }, []);

  const waitForRecognizerFlush = useCallback((timeoutMs = 900) => {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        flushWaitRef.current = null;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      flushWaitRef.current = done;
    });
  }, []);

  const appendTranscript = useCallback((chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    const next = transcriptRef.current
      ? `${transcriptRef.current} ${trimmed}`.trim()
      : trimmed;
    transcriptRef.current = next;
    partialRef.current = '';
    setTranscript(next);
    setPartialTranscript('');
    notifyFlushWaiters();
  }, [notifyFlushWaiters]);

  const stopEngine = useCallback(async () => {
    stoppedEpochRef.current = speechEpochRef.current;
    if (Platform.OS === 'web') {
      webRecognitionRef.current?.stop();
      webRecognitionRef.current = null;
      listeningRef.current = false;
      setListening(false);
      return;
    }

    if (!listeningRef.current) return;

    try {
      await nativeVoiceRef.current?.stop?.();
    } catch {
      // ignore stop errors; results may still arrive
    }
    listeningRef.current = false;
    setListening(false);
    await waitForRecognizerFlush();
  }, [waitForRecognizerFlush]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const w = window as Window & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
      setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
      return;
    }

    let mounted = true;
    const nativeModule = getVoiceNativeModule();
    const emitter = nativeModule ? new NativeEventEmitter(nativeModule) : null;

    const handleResults = (event: SpeechResultsPayload) => {
      const chunk = event.value?.[0]?.trim();
      if (chunk) appendTranscript(chunk);
    };

    const handlePartialResults = (event: SpeechResultsPayload) => {
      const chunk = event.value?.[0]?.trim() ?? '';
      partialRef.current = chunk;
      setPartialTranscript(chunk);
      if (chunk) notifyFlushWaiters();
    };

    const handleSpeechError = (event: SpeechErrorPayload) => {
      if (!listeningRef.current && speechEpochRef.current > stoppedEpochRef.current) return;
      const code = speechErrorCode(event);
      // Android often emits these between phrases; not a hard failure.
      if (code === '6' || code === '7') return;
      const message = event.error?.message ?? '';
      if (code === '9' || message.toLowerCase().includes('insufficient')) {
        setError(
          'Microphone permission is required for voice. Enable it in Settings → Apps → Rasoi Buddy → Permissions.',
        );
      } else if (code === '8' || message.toLowerCase().includes('recognizer')) {
        setError(
          'Speech recognition is busy or unavailable. Close other voice apps and try again.',
        );
      } else {
        setError('Could not hear that. Try again.');
      }
      listeningRef.current = false;
      setListening(false);
      setPaused(true);
      clearTimer();
      notifyFlushWaiters();
    };

    const handleSpeechEnd = () => {
      if (!listeningRef.current && speechEpochRef.current > stoppedEpochRef.current) return;
      if (partialRef.current) {
        appendTranscript(partialRef.current);
      }
      listeningRef.current = false;
      setListening(false);
      setPaused(true);
      clearTimer();
      notifyFlushWaiters();
    };

    const subscriptions = emitter
      ? [
          emitter.addListener('onSpeechResults', handleResults),
          emitter.addListener('onSpeechPartialResults', handlePartialResults),
          emitter.addListener('onSpeechError', handleSpeechError),
          emitter.addListener('onSpeechEnd', handleSpeechEnd),
        ]
      : [];

    void (async () => {
      try {
        const Voice = (await import('@react-native-voice/voice')).default;
        if (!mounted) return;

        nativeVoiceRef.current = Voice as unknown as NonNullable<typeof nativeVoiceRef.current>;
        if (Platform.OS === 'android') {
          setSupported(Boolean(nativeModule));
        } else {
          const available = await Voice.isAvailable();
          setSupported(Boolean(available));
        }
      } catch {
        if (mounted) setSupported(false);
      }
    })();

    return () => {
      mounted = false;
      subscriptions.forEach((sub) => sub.remove());
      clearTimer();
      void nativeVoiceRef.current?.destroy?.();
      nativeVoiceRef.current = null;
    };
  }, [appendTranscript, clearTimer, notifyFlushWaiters]);

  const startListening = useCallback(async () => {
    setError(null);
    speechEpochRef.current += 1;

    if (Platform.OS === 'android') {
      const micOk = await ensureMicPermission();
      if (!micOk) {
        speechEpochRef.current -= 1;
        setError(
          'Microphone permission is required for voice. Enable it in Settings → Apps → Rasoi Buddy → Permissions.',
        );
        return false;
      }
    }

    if (!supported && !nativeVoiceRef.current) {
      speechEpochRef.current -= 1;
      setError('Voice input is not available on this device.');
      return false;
    }

    if (Platform.OS === 'web') {
      const w = window as Window & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!SR) {
        speechEpochRef.current -= 1;
        setError('Voice input is not available in this browser.');
        return false;
      }

      const recognition = new SR();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            appendTranscript(text);
          } else {
            interim = text;
          }
        }
        partialRef.current = interim;
        setPartialTranscript(interim);
      };
      recognition.onerror = () => {
        if (webRecognitionRef.current !== recognition) return;
        setError('Could not hear that. Try again.');
        listeningRef.current = false;
        setListening(false);
        setPaused(true);
        clearTimer();
      };
      recognition.onend = () => {
        if (webRecognitionRef.current !== recognition) return;
        if (partialRef.current) {
          appendTranscript(partialRef.current);
        }
        listeningRef.current = false;
        setListening(false);
        setPaused(true);
        clearTimer();
        webRecognitionRef.current = null;
      };

      webRecognitionRef.current = recognition;
      recognition.start();
      listeningRef.current = true;
      setListening(true);
      setPaused(false);
      startTimer();
      return true;
    }

    const voice = nativeVoiceRef.current;
    if (!voice) {
      speechEpochRef.current -= 1;
      setError('Voice input is not available on this device. Rebuild the app with npm run android.');
      return false;
    }

    try {
      if (listeningRef.current) {
        try {
          await voice.stop();
        } catch {
          // ignore
        }
      }

      const androidOpts =
        Platform.OS === 'android'
          ? {
              REQUEST_PERMISSIONS_AUTO: false,
              EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2500,
              EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2500,
            }
          : undefined;

      await voice.start(lang, androidOpts);
      listeningRef.current = true;
      setListening(true);
      setPaused(false);
      startTimer();
      return true;
    } catch (err) {
      speechEpochRef.current -= 1;
      setError(voiceStartErrorMessage(err));
      listeningRef.current = false;
      setListening(false);
      return false;
    }
  }, [appendTranscript, clearTimer, lang, startTimer, supported]);

  const startRecording = useCallback(async () => {
    resetSession();
    setIsRecording(true);
    const ok = await startListening();
    if (!ok) {
      resetSession();
    }
  }, [resetSession, startListening]);

  const pauseRecording = useCallback(() => {
    void (async () => {
      if (!listening) return;
      await stopEngine();
      if (partialRef.current) {
        appendTranscript(partialRef.current);
      }
      setPaused(true);
      clearTimer();
    })();
  }, [appendTranscript, clearTimer, listening, stopEngine]);

  const resumeRecording = useCallback(async () => {
    if (!isRecording || listening) return;
    const ok = await startListening();
    if (ok) {
      setPaused(false);
    } else {
      setPaused(true);
    }
  }, [isRecording, listening, startListening]);

  const cancelRecording = useCallback(() => {
    void (async () => {
      if (Platform.OS !== 'web') {
        try {
          await nativeVoiceRef.current?.cancel?.();
        } catch {
          // ignore
        }
      } else {
        webRecognitionRef.current?.abort();
        webRecognitionRef.current = null;
      }
      listeningRef.current = false;
      setListening(false);
      resetSession();
    })();
  }, [resetSession]);

  const submitRecording = useCallback(() => {
    void (async () => {
      await stopEngine();
      if (partialRef.current) {
        appendTranscript(partialRef.current);
      }
      const finalText = transcriptRef.current.trim();
      resetSession();
      if (finalText) {
        onResultRef.current(finalText);
      } else {
        setError('No speech detected. Try again.');
      }
    })();
  }, [appendTranscript, resetSession, stopEngine]);

  const displayTranscript = partialTranscript
    ? transcript
      ? `${transcript} ${partialTranscript}`.trim()
      : partialTranscript
    : transcript;

  return {
    supported,
    error,
    clearError: () => setError(null),
    isRecording,
    listening,
    paused,
    transcript: displayTranscript,
    durationLabel: formatDuration(durationSec),
    startRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    submitRecording,
  };
}
