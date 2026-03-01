import { useCallback, useEffect, useState } from "react";

export interface AudioDevice {
  deviceId: string;
  label: string;
}

interface UseAudioDevicesResult {
  inputDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  selectedInputId: string;
  selectedOutputId: string;
  setSelectedInputId: (id: string) => void;
  setSelectedOutputId: (id: string) => void;
  refreshDevices: () => Promise<void>;
}

const STORAGE_KEY_INPUT = "reprise-input-device";
const STORAGE_KEY_OUTPUT = "reprise-output-device";

export function useAudioDevices(): UseAudioDevicesResult {
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState(
    () => localStorage.getItem(STORAGE_KEY_INPUT) ?? ""
  );
  const [selectedOutputId, setSelectedOutputId] = useState(
    () => localStorage.getItem(STORAGE_KEY_OUTPUT) ?? ""
  );

  const refreshDevices = useCallback(async () => {
    try {
      // Request mic permission first so labels are populated
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();

      const inputs = devices
        .filter((d) => d.kind === "audioinput" && d.deviceId)
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
        }));

      const outputs = devices
        .filter((d) => d.kind === "audiooutput" && d.deviceId)
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${d.deviceId.slice(0, 6)}`,
        }));

      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Reset selection if saved device no longer exists
      const savedInput = localStorage.getItem(STORAGE_KEY_INPUT);
      if (savedInput && !inputs.some((d) => d.deviceId === savedInput)) {
        setSelectedInputId("");
        localStorage.removeItem(STORAGE_KEY_INPUT);
      }
      const savedOutput = localStorage.getItem(STORAGE_KEY_OUTPUT);
      if (savedOutput && !outputs.some((d) => d.deviceId === savedOutput)) {
        setSelectedOutputId("");
        localStorage.removeItem(STORAGE_KEY_OUTPUT);
      }
    } catch {
      // Permission denied or no devices
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  const handleSetInput = useCallback((id: string) => {
    setSelectedInputId(id);
    if (id) localStorage.setItem(STORAGE_KEY_INPUT, id);
    else localStorage.removeItem(STORAGE_KEY_INPUT);
  }, []);

  const handleSetOutput = useCallback((id: string) => {
    setSelectedOutputId(id);
    if (id) localStorage.setItem(STORAGE_KEY_OUTPUT, id);
    else localStorage.removeItem(STORAGE_KEY_OUTPUT);
  }, []);

  return {
    inputDevices,
    outputDevices,
    selectedInputId,
    selectedOutputId,
    setSelectedInputId: handleSetInput,
    setSelectedOutputId: handleSetOutput,
    refreshDevices,
  };
}
