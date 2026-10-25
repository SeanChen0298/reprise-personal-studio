import { useMemo } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibraryStore } from "../src/stores/library-store";
import { usePrefsStore, type ThemeMode } from "../src/stores/prefs-store";
import { ACCENTS, useTheme } from "../src/lib/theme";
import { megabytes, timeAgo } from "../src/lib/format";
import { BackIcon } from "../src/components/icons";

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pairing = useLibraryStore((s) => s.pairing);
  const snapshot = useLibraryStore((s) => s.snapshot);
  const local = useLibraryStore((s) => s.local);
  const syncing = useLibraryStore((s) => s.syncing);
  const lastSync = useLibraryStore((s) => s.lastSync);
  const syncError = useLibraryStore((s) => s.syncError);
  const prefs = usePrefsStore();

  const stored = useMemo(
    () => Object.values(local.downloads).reduce((n, d) => n + Object.values(d ?? {}).reduce((m, f) => m + (f?.size ?? 0), 0), 0),
    [local.downloads],
  );
  const missing = useMemo(() => (snapshot?.songs ?? []).filter((s) => snapshot?.files[s.id]?.audio && !local.downloads[s.id]?.audio), [snapshot, local.downloads]);
  const unsent = local.takes.filter((x) => !x.uploaded).length;

  const section = (title: string) => (
    <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: t.muted, textTransform: "uppercase", marginTop: 26, marginBottom: 8 }}>{title}</Text>
  );
  const row = (label: string, right: React.ReactNode, sub?: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.borderSubtle }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ fontSize: 15, color: t.text }}>{label}</Text>
        {!!sub && <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 2, lineHeight: 17 }}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
  const button = (label: string, onPress: () => void, danger = false) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, borderWidth: 1.5, borderColor: danger ? t.danger : t.border, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 13.5, color: danger ? t.danger : t.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4, marginLeft: -6 }}>
          <BackIcon color={t.text} size={22} />
        </Pressable>
        <Text style={{ fontFamily: "serif", fontSize: 24, color: t.text }}>Settings</Text>
      </View>

      {section("Computer")}
      {pairing ? (
        <>
          {row(
            pairing.name,
            button(syncing ? "Syncing…" : "Sync now", () => useLibraryStore.getState().sync()),
            `${pairing.host}${lastSync ? ` · synced ${timeAgo(lastSync)}` : ""}${unsent ? ` · ${unsent} take${unsent === 1 ? "" : "s"} to send` : ""}`,
          )}
          {syncError && <Text style={{ fontSize: 13, color: syncError.unreachable ? t.muted : t.danger, marginTop: 8, lineHeight: 18 }}>{syncError.message}</Text>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            {button("Pair again", () => router.push("/pair"))}
            {button(
              "Unpair",
              () =>
                Alert.alert("Unpair this phone?", "Songs and audio stay on the phone; it just stops syncing.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Unpair", style: "destructive", onPress: () => useLibraryStore.getState().unpair() },
                ]),
              true,
            )}
          </View>
        </>
      ) : (
        row("Not paired", button("Pair", () => router.push("/pair")), "On the computer: Settings → Phone")
      )}

      {section("Audio on this phone")}
      {row(
        `${megabytes(stored)} used`,
        missing.length && pairing
          ? button(`Get all (${missing.length})`, async () => {
              for (const s of missing) await useLibraryStore.getState().downloadSong(s.id);
            })
          : null,
        missing.length ? `${missing.length} song${missing.length === 1 ? "" : "s"} not on the phone yet` : "Every song's audio is here.",
      )}
      {row("Get audio when a song opens", <Switch value={prefs.autoDownload} onValueChange={prefs.setAutoDownload} trackColor={{ true: t.theme, false: t.border }} thumbColor="#fff" />, "Only when the computer is reachable.")}
      {stored > 0 && (
        <View style={{ marginTop: 12, alignSelf: "flex-start" }}>
          {button(
            "Remove all audio",
            () =>
              Alert.alert("Remove all audio from this phone?", "Lyrics, notes and takes stay. You can get the audio again from the computer.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove",
                  style: "destructive",
                  onPress: async () => {
                    for (const id of Object.keys(useLibraryStore.getState().local.downloads)) await useLibraryStore.getState().removeDownloads(id);
                  },
                },
              ]),
            true,
          )}
        </View>
      )}

      {section("Takes")}
      {row(
        "Count-in",
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[0, 2, 3, 4].map((n) => (
            <Pressable key={n} onPress={() => prefs.setCountIn(n)} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, backgroundColor: prefs.countIn === n ? t.themeSoft : t.bg }}>
              <Text style={{ fontSize: 13.5, color: prefs.countIn === n ? t.themeText : t.textSecondary }}>{n === 0 ? "Off" : `${n}s`}</Text>
            </Pressable>
          ))}
        </View>,
        "Use headphones — the song shouldn't go into the mic.",
      )}

      {section("Look")}
      {row(
        "Theme",
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["auto", "light", "dark"] as ThemeMode[]).map((m) => (
            <Pressable key={m} onPress={() => prefs.setThemeMode(m)} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, backgroundColor: prefs.themeMode === m ? t.themeSoft : t.bg }}>
              <Text style={{ fontSize: 13.5, color: prefs.themeMode === m ? t.themeText : t.textSecondary }}>{m === "auto" ? "Auto" : m === "light" ? "Light" : "Dark"}</Text>
            </Pressable>
          ))}
        </View>,
      )}
      <View style={{ paddingVertical: 12, gap: 10 }}>
        <Text style={{ fontSize: 15, color: t.text }}>Colour</Text>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Pressable onPress={() => prefs.setAccent(null)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: prefs.accent == null ? t.themeSoft : t.bg }}>
            <Text style={{ fontSize: 13, color: prefs.accent == null ? t.themeText : t.textSecondary }}>Same as computer</Text>
          </Pressable>
          {Object.entries(ACCENTS).map(([k, a]) => (
            <Pressable key={k} onPress={() => prefs.setAccent(k)} hitSlop={6}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: a.light, borderWidth: prefs.accent === k ? 3 : 0, borderColor: t.text }} />
            </Pressable>
          ))}
        </View>
      </View>

      {!!snapshot?.singer_facts.length && (
        <>
          {section("What the coach knows about you")}
          {snapshot.singer_facts.map((f, i) => (
            <Text key={i} style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary, marginBottom: 4 }}>
              • {f}
            </Text>
          ))}
          <Text style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>Kept by the coach on your computer.</Text>
        </>
      )}
    </ScrollView>
  );
}
