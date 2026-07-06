import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

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

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
    start: (locale: string) => Promise<unknown>;
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

  const stopEngine = useCallback(() => {
    stoppedEpochRef.current = speechEpochRef.current;
    if (Platform.OS === 'web') {
      webRecognitionRef.current?.stop();
      webRecognitionRef.current = null;
    } else {
      void nativeVoiceRef.current?.stop?.();
    }
    listeningRef.current = false;
    setListening(false);
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
  }, []);

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
    void (async () => {
      try {
        const Voice = (await import('@react-native-voice/voice')).default;
        if (!mounted) return;

        Voice.onSpeechResults = (event) => {
          const chunk = event.value?.[0]?.trim();
          if (chunk) appendTranscript(chunk);
        };
        Voice.onSpeechPartialResults = (event) => {
          const chunk = event.value?.[0]?.trim() ?? '';
          partialRef.current = chunk;
          setPartialTranscript(chunk);
        };
        Voice.onSpeechError = () => {
          if (!listeningRef.current && speechEpochRef.current > stoppedEpochRef.current) return;
          setError('Could not hear that. Try again.');
          listeningRef.current = false;
          setListening(false);
          setPaused(true);
          clearTimer();
        };
        Voice.onSpeechEnd = () => {
          if (!listeningRef.current && speechEpochRef.current > stoppedEpochRef.current) return;
          if (partialRef.current) {
            appendTranscript(partialRef.current);
          }
          listeningRef.current = false;
          setListening(false);
          setPaused(true);
          clearTimer();
        };

        nativeVoiceRef.current = Voice as unknown as NonNullable<typeof nativeVoiceRef.current>;
        const available = await Voice.isAvailable();
        setSupported(Boolean(available));
      } catch {
        if (mounted) setSupported(false);
      }
    })();

    return () => {
      mounted = false;
      clearTimer();
      void nativeVoiceRef.current?.destroy?.();
      nativeVoiceRef.current = null;
    };
  }, [appendTranscript, clearTimer]);

  const startListening = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError('Voice input is not available on this device.');
      return false;
    }

    // Bump before any async work so stale pause/end handlers from a prior session are ignored.
    speechEpochRef.current += 1;

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

    try {
      await nativeVoiceRef.current?.start(lang);
      listeningRef.current = true;
      setListening(true);
      setPaused(false);
      startTimer();
      return true;
    } catch {
      speechEpochRef.current -= 1;
      setError('Microphone permission is required for voice.');
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
    if (!listening) return;
    stopEngine();
    if (partialRef.current) {
      appendTranscript(partialRef.current);
    }
    setPaused(true);
    clearTimer();
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
    stopEngine();
    if (Platform.OS !== 'web') {
      void nativeVoiceRef.current?.cancel?.();
    }
    resetSession();
  }, [resetSession, stopEngine]);

  const submitRecording = useCallback(() => {
    stopEngine();
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
