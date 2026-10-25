// Library: the song to pick up again (big, one action), then every song.
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Song } from "@reprise/shared/core";
import { useLibraryStore } from "../src/stores/library-store";
import { useTheme, type Theme } from "../src/lib/theme";
import { recentSongs } from "../src/lib/recent";
import { timeAgo } from "../src/lib/format";
import { Thumb } from "../src/components/thumb";
import { DownloadIcon, PlayIcon, SettingsIcon } from "../src/components/icons";

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
    <Pressable onPress={() => (pairing ? useLibraryStore.getState().sync() : router.push("/pair"))} hitSlop={8}>
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
  const songs = useMemo(() => [...(snapshot?.songs ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [snapshot]);
  const hero = recent[0];
  const open = (song: Song) => router.push(`/song/${song.id}`);

  const onPhone = (id: string) => !!local.downloads[id]?.audio;

  const header = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 10, paddingBottom: 14 }}>
        <Text style={{ fontFamily: "serif", fontSize: 26, color: t.text, letterSpacing: -0.5 }}>Reprise</Text>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.theme, marginLeft: 4, marginTop: 6 }} />
        <View style={{ flex: 1 }} />
        <SyncPill t={t} />
        <Pressable onPress={() => router.push("/settings")} hitSlop={10} style={{ marginLeft: 14 }}>
          <SettingsIcon color={t.textSecondary} size={21} />
        </Pressable>
      </View>

      {syncError && !syncError.unreachable && (
        <Text style={{ fontSize: 12.5, color: t.danger, marginBottom: 12 }}>{syncError.message}</Text>
      )}

      {!snapshot && (
        <View style={{ padding: 20, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderSubtle, gap: 10, marginTop: 8 }}>
          <Text style={{ fontFamily: "serif", fontSize: 22, color: t.text }}>Your songs, on your phone</Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary }}>
            Reprise on your phone gets its songs from Reprise on your computer, over your home Wi-Fi — lyrics, your marks and
            notes, sections, the coach's song cards and the audio. Then it works anywhere.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary }}>
            On the computer: Settings → Phone → switch on “Sync with my phone”.
          </Text>
          {pairing ? (
            <Text style={{ fontSize: 13.5, color: t.muted }}>{syncing ? "Syncing…" : syncError?.message ?? "Pull down to sync."}</Text>
          ) : (
            <Pressable onPress={() => router.push("/pair")} style={{ alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, backgroundColor: t.accent }}>
              <Text style={{ color: t.onAccent, fontSize: 14.5, fontWeight: "600" }}>Pair with computer</Text>
            </Pressable>
          )}
        </View>
      )}

      {hero && (
        <Pressable onPress={() => open(hero.song)} style={{ borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderSubtle, overflow: "hidden", marginBottom: 22 }}>
          <Thumb song={hero.song} radius={0} />
          <View style={{ padding: 16, gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1, color: t.theme, textTransform: "uppercase" }}>
              {hero.kind === "added" ? "Start here" : "Pick up where you left off"}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: "serif", fontSize: 26, color: t.text, letterSpacing: -0.5 }}>
              {hero.song.title}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 14, color: t.muted }}>
              {hero.song.artist}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: t.accent }}>
                <PlayIcon color={t.onAccent} size={13} />
                <Text style={{ color: t.onAccent, fontSize: 14.5, fontWeight: "600" }}>{hero.kind === "added" ? "Open" : "Continue"}</Text>
              </View>
              <Text style={{ marginLeft: 12, fontSize: 12.5, color: t.textSecondary }}>
                {hero.kind === "take" ? "Last take" : hero.kind === "practice" ? "Last practised" : "Added"} {timeAgo(hero.at)}
              </Text>
            </View>
          </View>
        </Pressable>
      )}

      {songs.length > 0 && (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: t.textSecondary }}>All songs</Text>
          <Text style={{ fontSize: 12.5, color: t.muted }}>{songs.length}</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
      data={songs}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl refreshing={syncing} onRefresh={() => (pairing ? useLibraryStore.getState().sync() : router.push("/pair"))} tintColor={t.theme} colors={[t.theme]} />
      }
      renderItem={({ item }) => {
        const progress = downloading[item.id];
        const hasAudio = !!snapshot?.files[item.id]?.audio;
        return (
          <Pressable onPress={() => open(item)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
            <Thumb song={item} width={72} radius={6} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, color: t.text }}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 13, color: t.muted, marginTop: 1 }}>
                {item.artist}
              </Text>
            </View>
            {progress != null ? (
              <ActivityIndicator size="small" color={t.theme} />
            ) : hasAudio && !onPhone(item.id) ? (
              <Pressable onPress={() => useLibraryStore.getState().downloadSong(item.id)} hitSlop={10}>
                <DownloadIcon color={t.muted} size={18} />
              </Pressable>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
