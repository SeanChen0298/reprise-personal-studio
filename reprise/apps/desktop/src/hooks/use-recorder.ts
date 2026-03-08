import { useRef, useState, useCallback } from "react";
import { mkdir, exists, writeFile } from "@tauri-apps/plugin-fs";

export interface RecordingResult {
  filePath: string;
  durationMs: number;
  lineId: string;
}

export interface UseRecorderResult {
  isRecording: boolean;
  error: string | null;
  startRecording: (lineId: string, songFolder: string, inputDeviceId?: string) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
  /** Returns current mic input level 0–1 (call in RAF loop during recording) */
  getInputLevel: () => number;
}

export function useRecorder(): UseRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const lineIdRef = useRef<string>("");
  const songFolderRef = useRef<string>("");
  const streamRef = useRef<MediaStream | null>(null);
  const resolveStopRef = useRef<((result: RecordingResult | null) => void) | null>(null);

  // Audio analysis for input level meter
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array | null>(null);

  const getInputLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = analyserDataRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / (data.length * 255);
  }, []);

  const startRecording = useCallback(async (lineId: string, songFolder: string, inputDeviceId?: string) => {
    setError(null);
    lineIdRef.current = lineId;
    songFolderRef.current = songFolder;
    chunksRef.current = [];

    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 1,
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;

      // Set up analyser for input level meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      startTimeRef.current = Date.now();
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(msg);
    }
  }, []);

  const stopRecording = useCallback((): Promise<RecordingResult | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        setIsRecording(false);
        resolve(null);
        return;
      }

      resolveStopRef.current = resolve;

      recorder.onstop = async () => {
        const durationMs = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        // Stop mic stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        // Clean up analyser
        analyserRef.current = null;
        analyserDataRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;

        setIsRecording(false);

        try {
          // Ensure recordings folder exists
          const recordingsDir = `${songFolderRef.current}/recordings`;
          if (!(await exists(recordingsDir))) {
            await mkdir(recordingsDir, { recursive: true });
          }

          // Write file
          const timestamp = Date.now();
          const fileName = `${lineIdRef.current.slice(0, 8)}_${timestamp}.webm`;
          const filePath = `${recordingsDir}/${fileName}`;
          const arrayBuffer = await blob.arrayBuffer();
          await writeFile(filePath, new Uint8Array(arrayBuffer));

          const result: RecordingResult = {
            filePath,
            durationMs,
            lineId: lineIdRef.current,
          };
          resolveStopRef.current?.(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to save recording";
          setError(msg);
          resolveStopRef.current?.(null);
        }
        resolveStopRef.current = null;
      };

      recorder.stop();
    });
  }, []);

  return { isRecording, error, startRecording, stopRecording, getInputLevel };
}
