// Pair with the computer: scan the QR code from Settings → Phone, or type the address and code.
import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { DISPLAY, Text } from "../src/components/text";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibraryStore } from "../src/stores/library-store";
import { parsePairingUrl, type Pairing } from "../src/lib/sync-client";
import { useTheme } from "../src/lib/theme";

export default function Pair() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState("");
  const [code, setCode] = useState("");
  const handled = useRef(false);

  const tryPair = async (p: Pairing) => {
    setBusy(true);
    setError(null);
    try {
      await useLibraryStore.getState().pair(p);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      handled.current = false;
    } finally {
      setBusy(false);
    }
  };

  const onScan = (data: string) => {
    if (handled.current || busy) return;
    const p = parsePairingUrl(data);
    if (!p) {
      setError("That's not a Reprise pairing code. On the computer: Settings → Phone.");
      return;
    }
    handled.current = true;
    void tryPair(p);
  };

  const field = {
    borderWidth: 1.5,
    borderColor: t.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: t.text,
    backgroundColor: t.surface,
  } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 24, color: t.text, flex: 1 }}>Pair with computer</Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={{ fontSize: 15, color: t.theme }}>Close</Text>
          </Pressable>
        </View>
        <Text style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary }}>
          On the computer, open Reprise → Settings → Phone and switch on “Sync with my phone”. Keep both on the same Wi-Fi, then scan the code.
        </Text>

        {!manual && (
          <View style={{ borderRadius: 16, overflow: "hidden", aspectRatio: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
            {permission?.granted ? (
              <CameraView
                style={{ width: "100%", height: "100%" }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={(e) => onScan(e.data)}
              />
            ) : (
              <Pressable onPress={requestPermission} style={{ padding: 20, alignItems: "center", gap: 8 }}>
                <Text style={{ color: "#fff", fontSize: 15, textAlign: "center" }}>Reprise needs the camera to scan the code.</Text>
                <Text style={{ color: "#93C5FD", fontSize: 15, fontWeight: "600" }}>Allow camera</Text>
              </Pressable>
            )}
            {busy && (
              <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" }}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={{ color: "#fff", marginTop: 10 }}>Connecting…</Text>
              </View>
            )}
          </View>
        )}

        {error && <Text style={{ fontSize: 13.5, color: t.danger, lineHeight: 19 }}>{error}</Text>}

        <Pressable onPress={() => setManual((v) => !v)}>
          <Text style={{ fontSize: 14, color: t.theme }}>{manual ? "Scan the code instead" : "Can't scan? Type the code"}</Text>
        </Pressable>

        {manual && (
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, color: t.muted }}>Address shown under the QR code (like 192.168.1.20:47615)</Text>
            <TextInput value={host} onChangeText={setHost} placeholder="192.168.1.20:47615" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field} />
            <Text style={{ fontSize: 13, color: t.muted }}>Code (“Can't scan? Show the code” on the computer)</Text>
            <TextInput value={code} onChangeText={(v) => setCode(v.trim().toLowerCase())} placeholder="24 letters and numbers" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} style={field} />
            <Pressable
              disabled={busy || !/^[\w.-]+:\d+$/.test(host.trim()) || code.length < 16}
              onPress={() => tryPair({ host: host.trim(), token: code, name: "Computer" })}
              style={({ pressed }) => ({ alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: t.accent, opacity: pressed || busy ? 0.6 : 1 })}
            >
              <Text style={{ color: t.onAccent, fontSize: 14.5, fontWeight: "600" }}>{busy ? "Connecting…" : "Pair"}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
