// Settings: grouped cards made of the same pieces as the rest of the app.
import { useMemo, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toggle } from "../src/components/toggle";
import { DISPLAY, Text } from "../src/components/text";
import { Button, Card, Label, Segmented } from "../src/components/ui";
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

  const group = (title: string, children: ReactNode) => (
    <View style={{ marginTop: 26, gap: 10 }}>
      <Label t={t} style={{ paddingHorizontal: 4 }}>
        {title}
      </Label>
      <Card t={t} style={{ paddingVertical: 4 }}>
        {children}
      </Card>
    </View>
  );
  /** One setting: the words on top, its control below (or beside, when it's small). */
  const row = (label: string, control: ReactNode, sub?: string, opts: { below?: boolean; last?: boolean } = {}) => (
    <View style={{ paddingVertical: 12, borderBottomWidth: opts.last ? 0 : 1, borderBottomColor: t.borderSubtle, gap: opts.below ? 10 : 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15.5, color: t.text }}>{label}</Text>
          {!!sub && <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 3, lineHeight: 17 }}>{sub}</Text>}
        </View>
        {!opts.below && control}
      </View>
      {opts.below && control}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 36 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 40, height: 44, justifyContent: "center", marginLeft: -6 }}>
            <BackIcon color={t.text} size={22} />
          </Pressable>
          <Text style={{ fontFamily: DISPLAY, fontSize: 28, color: t.text, letterSpacing: -0.6 }}>Settings</Text>
        </View>

        {group(
          "Your computer",
          pairing ? (
            <View style={{ paddingVertical: 12, gap: 12 }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: "500", color: t.text }}>{pairing.name}</Text>
                <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 3 }}>
                  {lastSync ? `Synced ${timeAgo(lastSync)}` : "Not synced yet"}
                  {unsent ? ` · ${unsent} take${unsent === 1 ? "" : "s"} to send` : ""}
                </Text>
                {syncError && <Text style={{ fontSize: 13, color: syncError.unreachable ? t.muted : t.danger, marginTop: 6, lineHeight: 18 }}>{syncError.message}</Text>}
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button t={t} kind="soft" label={syncing ? "Syncing…" : "Sync now"} onPress={() => useLibraryStore.getState().sync({ force: true })} />
                <Button t={t} kind="plain" label="Pair again" onPress={() => router.push("/pair")} />
                <Button
                  t={t}
                  kind="plain"
                  danger
                  label="Unpair"
                  onPress={() =>
                    Alert.alert("Unpair this phone?", "Songs and audio stay on the phone; it just stops syncing.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Unpair", style: "destructive", onPress: () => useLibraryStore.getState().unpair() },
                    ])
                  }
                />
              </View>
            </View>
          ) : (
            row("Not paired", <Button t={t} kind="soft" label="Pair" onPress={() => router.push("/pair")} />, "On the computer: Settings → Phone", { last: true })
          ),
        )}

        {group(
          "Audio on this phone",
          <>
            {row(
              `${megabytes(stored)} used`,
              missing.length && pairing ? (
                <Button
                  t={t}
                  kind="soft"
                  label={`Get all (${missing.length})`}
                  onPress={async () => {
                    for (const s of missing) await useLibraryStore.getState().downloadSong(s.id);
                  }}
                />
              ) : null,
              missing.length ? `${missing.length} song${missing.length === 1 ? "" : "s"} not on the phone yet` : "Every song's audio is here.",
            )}
            {row(
              "Keep recent songs ready",
              <Segmented t={t} options={[0, 3, 5, 10]} value={prefs.keepRecent} onChange={prefs.setKeepRecent} label={(n) => (n === 0 ? "Off" : String(n))} />,
              "The songs you've worked on most recently are fetched at home, so they're there when you're out.",
              { below: true },
            )}
            {row("Get audio when a song opens", <Toggle value={prefs.autoDownload} onChange={prefs.setAutoDownload} t={t} />, "Only when the computer is reachable.", { last: stored === 0 })}
            {stored > 0 && (
              <View style={{ paddingVertical: 8 }}>
                <Button
                  t={t}
                  kind="plain"
                  danger
                  label="Remove all audio"
                  style={{ alignSelf: "flex-start" }}
                  onPress={() =>
                    Alert.alert("Remove all audio from this phone?", "Lyrics, notes and takes stay. You can get the audio again from the computer.", [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: async () => {
                          for (const id of Object.keys(useLibraryStore.getState().local.downloads)) await useLibraryStore.getState().removeDownloads(id);
                        },
                      },
                    ])
                  }
                />
              </View>
            )}
          </>,
        )}

        {group(
          "Play all",
          row(
            "Plays",
            <Segmented t={t} options={["audio", "instrumental"] as const} value={prefs.radioTrack} onChange={prefs.setRadioTrack} label={(k) => (k === "audio" ? "The songs" : "The backing")} />,
            "The backing is for singing along on a walk. Hold the player bar to stop.",
            { below: true, last: true },
          ),
        )}

        {group(
          "Takes",
          row(
            "Count-in",
            <Segmented t={t} options={[0, 2, 3, 4]} value={prefs.countIn} onChange={prefs.setCountIn} label={(n) => (n === 0 ? "Off" : `${n} s`)} />,
            "Use headphones — the song shouldn't go into the mic.",
            { below: true, last: true },
          ),
        )}

        {group(
          "Look",
          <>
            {row("Theme", <Segmented t={t} options={["auto", "light", "dark"] as ThemeMode[]} value={prefs.themeMode} onChange={prefs.setThemeMode} label={(m) => (m === "auto" ? "Auto" : m === "light" ? "Light" : "Dark")} />)}
            {row(
              "Color",
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Pressable onPress={() => prefs.setAccent(null)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: prefs.accent == null ? t.themeSoft : "transparent" }}>
                  <Text style={{ fontSize: 13, color: prefs.accent == null ? t.themeText : t.textSecondary }}>Same as computer</Text>
                </Pressable>
                {Object.entries(ACCENTS).map(([k, a]) => (
                  <Pressable key={k} onPress={() => prefs.setAccent(k)} hitSlop={6}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.dark ? a.dark : a.light, borderWidth: prefs.accent === k ? 3 : 0, borderColor: t.surface, elevation: prefs.accent === k ? 3 : 0 }} />
                  </Pressable>
                ))}
              </View>,
              "Each song's own screen takes its color from the song's artwork.",
              { below: true, last: true },
            )}
          </>,
        )}

        {!!snapshot?.singer_facts.length &&
          group(
            "What the coach knows about you",
            <View style={{ paddingVertical: 12, gap: 8 }}>
              {snapshot.singer_facts.map((f, i) => (
                <Text key={i} style={{ fontSize: 14.5, lineHeight: 21, color: t.textSecondary }}>
                  {f}
                </Text>
              ))}
              <Text style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>Kept by the coach on your computer.</Text>
            </View>,
          )}
      </ScrollView>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: t.bg, opacity: 0.94 }} />
    </View>
  );
}
