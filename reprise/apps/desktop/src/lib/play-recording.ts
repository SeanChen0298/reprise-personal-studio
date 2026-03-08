import { convertFileSrc } from "@tauri-apps/api/core";
import { usePreferencesStore } from "../stores/preferences-store";

export interface RecordingPlaybackHandle {
  stop: () => void;
}

/**
 * Plays a recording file through AudioContext → GainNode → DynamicsCompressorNode.
 * Reads recordingPlaybackGain from the preferences store at call time.
 * Returns a handle to stop playback early, or rejects on error.
 */
export function playRecordingWithGain(
  filePath: string,
  onEnded?: () => void,
): Promise<RecordingPlaybackHandle> {
  const src = convertFileSrc(filePath);
  const ctx = new AudioContext();

  const cleanup = () => ctx.close().catch(() => {});

  return ctx
    .resume()
    .then(() => fetch(src))
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = usePreferencesStore.getState().recordingPlaybackGain;
      const compressor = ctx.createDynamicsCompressor();
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(ctx.destination);

      source.onended = () => {
        cleanup();
        onEnded?.();
      };
      source.start();

      return {
        stop: () => {
          try {
            source.stop();
          } catch {
            // already stopped
          }
          cleanup();
        },
      };
    })
    .catch((err) => {
      cleanup();
      throw err;
    });
}
