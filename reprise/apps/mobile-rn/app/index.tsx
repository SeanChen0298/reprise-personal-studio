// Library: the song to pick up again (in its color, one action), what you sang recently, then every song.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { DISPLAY, Text } from "../src/components/text";
import { PressableScale } from "../src/components/pressable-scale";
import { Button, Card } from "../src/components/ui";
import { paletteFor, vividColors } from "../src/lib/song-palette";
import { LinearGradient } from "expo-linear-gradient";
import { VividBackdrop } from "../src/components/vivid-backdrop";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Song } from "@reprise/shared/core";
import { useLibraryStore } from "../src/stores/library-store";
import { useTheme, type Theme } from "../src/lib/theme";
import { recentSongs } from "../src/lib/recent";
import { timeAgo } from "../src/lib/format";
import { Thumb } from "../src/components/thumb";
import { DownloadIcon, PlayIcon, SettingsIcon } from "../src/components/icons";
import { NowPlaying } from "../src/components/now-playing";
import { playAll, useRadio } from "../src/lib/radio";
import { usePrefsStore } from "../src/stores/prefs-store";

function SyncPill({ t }: { t: Theme }) {
  const pairing = useLibraryStore((s) => s.pairing);
  const syncing = useLibraryStore((s) => s.syncing);
  const err = useLibraryStore((s) => s.syncError);
  const last = useLibraryStore((s) => s.lastSync);
  let text: string;
  let tone = t.muted;
  if (!pairing) text = "Not paired";
  else if (syncing) text = "Syncing…";
  else if (err && !err.unreachable) {
    text = "Sync problem";
    tone = t.danger;
  } else if (last) text = `${err?.unreachable ? "Offline · " : ""}synced ${timeAgo(last)}`;
  else text = err?.unreachable ? "Can't reach computer" : "Not synced yet";
  return (
    <Pressable onPress={() => (pairing ? useLibraryStore.getState().sync({ force: true }) : router.push("/pair"))} hitSlop={8}>
      <Text style={{ fontSize: 12, color: tone }}>{text}</Text>
    </Pressable>
  );
}

export default function Library() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useLibraryStore((s) => s.snapshot);
  const local = useLibraryStore((s) => s.local);
  const pairing = useLibraryStore((s) => s.pairing);
  const syncing = useLibraryStore((s) => s.syncing);
  const syncError = useLibraryStore((s) => s.syncError);
  const downloading = useLibraryStore((s) => s.downloading);

  const recent = useMemo(() => recentSongs(snapshot, local.practiced, local.takes), [snapshot, local.practiced, local.takes]);
  const [query, setQuery] = useState("");
  const allSongs = useMemo(() => [...(snapshot?.songs ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [snapshot]);
  const songs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allSongs.filter((s) => s.title.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q) || s.tags?.some((t) => t.toLowerCase().includes(q))) : allSongs;
  }, [allSongs, query]);
  const hero = recent[0];
  const open = (song: Song) => router.push(`/song/${song.id}`);

  const onPhone = (id: string) => !!local.downloads[id]?.audio;
  const radioOn = useRadio((s) => s.on);
  const shuffle = usePrefsStore((s) => s.radioShuffle);
  const playable = useMemo(() => (snapshot?.songs ?? []).filter((s) => local.downloads[s.id]?.audio).length, [snapshot, local.downloads]);

  const heroP = paletteFor(hero ? snapshot?.colors?.[hero.song.id] : undefined, t);
  const recentMore = recent.slice(1, 9).map((r) => r.song);

  const header = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 12, paddingBottom: 18 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 30, color: t.text, letterSpacing: -0.8 }}>Reprise</Text>
        <View style={{ flex: 1 }} />
        <SyncPill t={t} />
        <Pressable onPress={() => router.push("/settings")} hitSlop={10} style={{ marginLeft: 16 }}>
          <SettingsIcon color={t.textSecondary} size={21} />
        </Pressable>
      </View>

      {syncError && !syncError.unreachable && <Text style={{ fontSize: 12.5, color: t.danger, marginBottom: 12 }}>{syncError.message}</Text>}

      {!snapshot && (
        <Card t={t} style={{ gap: 12, marginTop: 8 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 23, color: t.text }}>Your songs, on your phone</Text>
          <Text style={{ fontSize: 14.5, lineHeight: 21, color: t.textSecondary }}>
            Reprise on your phone gets its songs from Reprise on your computer, over your home Wi-Fi — lyrics, your marks and
            notes, the coach's song cards and the audio. Then it works anywhere.
          </Text>
          <Text style={{ fontSize: 14.5, lineHeight: 21, color: t.textSecondary }}>On the computer: Settings → Phone → switch on “Sync with my phone”.</Text>
          {pairing ? (
            <Text style={{ fontSize: 13.5, color: t.muted }}>{syncing ? "Syncing…" : syncError?.message ?? "Pull down to sync."}</Text>
          ) : (
            <Button t={t} label="Pair with computer" onPress={() => router.push("/pair")} style={{ alignSelf: "flex-start", marginTop: 4 }} />
          )}
        </Card>
      )}

      {/* The song to pick up again, in its own color */}
      {hero && !query && (
        <Animated.View entering={FadeInDown.duration(420)}>
          <PressableScale onPress={() => open(hero.song)} style={{ borderRadius: 26, backgroundColor: heroP.soft, overflow: "hidden", marginBottom: 26 }}>
            <Thumb song={hero.song} radius={0} aspect={16 / 9} zoom={1.12} />
            <View style={{ padding: 18, paddingTop: 16, gap: 3 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: heroP.tint }}>{hero.kind === "added" ? "Start here" : "Pick up where you left off"}</Text>
              <Text numberOfLines={1} style={{ fontFamily: DISPLAY, fontSize: 28, color: t.text, letterSpacing: -0.6, marginTop: 2 }}>
                {hero.song.title}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 14, color: t.textSecondary }}>
                {hero.song.artist}
                {hero.kind !== "added" ? ` · ${hero.kind === "take" ? "last take" : "practiced"} ${timeAgo(hero.at)}` : ""}
              </Text>
              <View style={{ flexDirection: "row", marginTop: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: heroP.solid }}>
                  <PlayIcon color={heroP.onSolid} size={13} />
                  <Text style={{ color: heroP.onSolid, fontSize: 14.5, fontWeight: "600" }}>{hero.kind === "added" ? "Open" : "Continue"}</Text>
                </View>
              </View>
            </View>
          </PressableScale>
        </Animated.View>
      )}

      {playable > 0 && !query && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 26 }}>
          <Button t={t} kind="soft" label="Play all" icon={<PlayIcon color={t.text} size={12} />} onPress={() => void playAll()} />
          <Button t={t} kind={shuffle ? "soft" : "plain"} label={shuffle ? "Shuffle on" : "Shuffle"} onPress={() => usePrefsStore.getState().setRadioShuffle(!shuffle)} />
        </View>
      )}

      {recentMore.length > 1 && !query && (
        <View style={{ marginBottom: 26 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 20, color: t.text, marginBottom: 12 }}>Recently</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }} style={{ marginRight: -16 }}>
            {recentMore.map((s) => (
              <PressableScale key={s.id} onPress={() => open(s)} style={{ width: 150, gap: 7 }}>
                <Thumb song={s} radius={16} aspect={1} zoom={1.05} />
                <View>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "500", color: t.text }}>
                    {s.title}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted }}>
                    {s.artist}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      {allSongs.length > 0 && (
        <View style={{ gap: 12, marginBottom: 12 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 20, color: t.text }}>{query ? `${songs.length} found` : "All songs"}</Text>
          {allSongs.length > 6 && (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search songs or artists"
              placeholderTextColor={t.muted}
              autoCorrect={false}
              style={{ height: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: t.dark ? "#FFFFFF0D" : "#0000000A", color: t.text, fontSize: 14.5, fontFamily: "Inter_400Regular" }}
            />
          )}
        </View>
      )}
    </View>
  );

  const look = usePrefsStore((s) => s.look);
  const heroHex = hero ? snapshot?.colors?.[hero.song.id] : undefined;
  const vivid = look === "vivid" ? vividColors(heroHex) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* The song you're on colors the page: its moving glows (Vivid) or a soft wash at the top (Classic) */}
      {vivid ? (
        <VividBackdrop hex={heroHex} top={vivid.top} bottom={vivid.bottom} energy={0.3} playing={radioOn} />
      ) : (
        <LinearGradient pointerEvents="none" colors={[heroP.soft, t.bg]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 520 }} />
      )}
      <FlatList
        style={{ flex: 1, backgroundColor: "transparent" }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + (radioOn ? 104 : 28) }}
        data={songs}
        keyExtractor={(s) => s.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={() => (pairing ? useLibraryStore.getState().sync({ force: true }) : router.push("/pair"))} tintColor={t.theme} colors={[t.theme]} />
        }
        renderItem={({ item, index }) => {
          const progress = downloading[item.id];
          const hasAudio = !!snapshot?.files[item.id]?.audio;
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30).duration(360)} style={{ flex: 1, maxWidth: "50%", marginBottom: 18 }}>
              <PressableScale scaleTo={0.97} onPress={() => open(item)} style={{ gap: 7 }}>
                <View>
                  <Thumb song={item} radius={16} zoom={1.05} />
                  {(progress != null || (hasAudio && !onPhone(item.id))) && (
                    <Pressable
                      onPress={() => useLibraryStore.getState().downloadSong(item.id)}
                      hitSlop={8}
                      style={{ position: "absolute", right: 8, bottom: 8, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" }}
                    >
                      {progress != null ? <ActivityIndicator size="small" color="#fff" /> : <DownloadIcon color="#fff" size={15} />}
                    </Pressable>
                  )}
                </View>
                <View>
                  <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: "500", color: t.text }}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted, marginTop: 1 }}>
                    {item.artist}
                  </Text>
                </View>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
      {/* Rows scroll under the status bar: give it the page color */}
      <LinearGradient pointerEvents="none" colors={[vivid ? vivid.top : heroP.soft, `${vivid ? vivid.top : heroP.soft}00`]} locations={[0.55, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 14 }} />
      {radioOn && <NowPlaying t={t} />}
    </View>
  );
}
