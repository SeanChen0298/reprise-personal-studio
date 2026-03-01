import { useRef, useState, useCallback } from "react";
import { mkdir, exists, writeFile } from "@tauri-apps/plugin-fs";

interface UseRecorderResult {
  isRecording: boolean;
  error: string | null;
  startRecording: (lineId: string, songFolder: string, inputDeviceId?: string) => Promise<void>;
  stopRecording: () => Promise<RecordingResult | null>;
}

interface RecordingResult {
  filePath: string;
  durationMs: number;
  lineId: string;
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

  const startRecording = useCallback(async (lineId: string, songFolder: string, inputDeviceId?: string) => {
    setError(null);
    lineIdRef.current = lineId;
    songFolderRef.current = songFolder;
    chunksRef.current = [];

    try {
      const audio: boolean | MediaTrackConstraints = inputDeviceId
        ? { deviceId: { exact: inputDeviceId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
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

  return { isRecording, error, startRecording, stopRecording };
}
