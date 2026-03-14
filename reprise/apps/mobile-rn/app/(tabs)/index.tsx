import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import type { Song } from "@reprise/shared";
import { useAuthStore } from "../../src/stores/auth-store";
import { fetchSongs } from "../../src/lib/supabase";
import { C } from "../../src/lib/theme";
import { IconMusic, IconChevronRight } from "../../src/components/icons";

export default function SongsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const data = await fetchSongs(user.id);
      data.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
      setSongs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load songs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color={C.theme} />
      </View>
    );
  }

  return (
    <View style={st.container}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Library</Text>
        {songs.length > 0 && (
          <Text style={st.headerCount}>
            {songs.length} {songs.length === 1 ? "song" : "songs"}
          </Text>
        )}
      </View>

      {error && (
        <View style={st.errorBanner}>
          <Text style={st.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={songs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={songs.length === 0 ? st.emptyList : undefined}
        ItemSeparatorComponent={() => <View style={st.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={C.theme}
          />
        }
        ListEmptyComponent={
          <View style={st.emptyContainer}>
            <View style={st.emptyIcon}>
              <IconMusic size={24} color={C.muted} />
            </View>
            <Text style={st.emptyTitle}>No songs yet</Text>
            <Text style={st.emptySubtitle}>
              Add songs on the desktop app, then sync them here via Google Drive.
            </Text>
          </View>
        }
        renderItem={({ item: song }) => (
          <TouchableOpacity
            style={st.row}
            onPress={() => router.push(`/song/${song.id}`)}
            activeOpacity={0.6}
          >
            {/* Thumbnail */}
            <View style={st.thumb}>
              {song.thumbnail_url ? (
                <Image source={{ uri: song.thumbnail_url }} style={st.thumbImg} />
              ) : (
                <View style={st.thumbPlaceholder}>
                  <IconMusic size={18} color={C.border} />
                </View>
              )}
              {song.pinned && <View style={st.pinnedDot} />}
            </View>

            {/* Info */}
            <View style={st.rowBody}>
              <Text style={st.rowTitle} numberOfLines={1}>{song.title}</Text>
              <Text style={st.rowArtist} numberOfLines={1}>{song.artist}</Text>
              {(song.drive_audio_file_id ||
                song.drive_vocals_file_id ||
                song.drive_instrumental_file_id) && (
                <View style={st.driveBadge}>
                  <Text style={st.driveBadgeText}>Drive</Text>
                </View>
              )}
            </View>

            {/* Mastery ring */}
            <MasteryRing value={song.mastery} />

            {/* Chevron */}
            <IconChevronRight size={16} color={C.border} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function MasteryRing({ value }: { value: number }) {
  const size = 26;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: C.theme,
        opacity: Math.max(0.12, (value / 100) * 0.85),
      }}
    />
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: C.bg,
  },
  headerTitle: { fontSize: 24, fontWeight: "600", color: C.text, letterSpacing: -0.3 },
  headerCount: { fontSize: 13, color: C.muted, marginTop: 2 },

  errorBanner: { margin: 16, padding: 12, backgroundColor: "#FEF2F2", borderRadius: 8 },
  errorText:   { fontSize: 13, color: "#EF4444" },

  separator:      { height: 0.5, backgroundColor: C.border, marginLeft: 76 },
  emptyList:      { flex: 1 },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyIcon: {
    width: 52, height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  emptyTitle:    { fontSize: 15, fontWeight: "500", color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 20 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  thumb:            { width: 48, height: 48, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
  thumbImg:         { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  pinnedDot: {
    position: "absolute",
    top: 3, right: 3,
    width: 5, height: 5,
    borderRadius: 3,
    backgroundColor: C.theme,
    opacity: 0.5,
  },
  rowBody:  { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: "500", color: C.text },
  rowArtist: { fontSize: 12, color: C.muted, marginTop: 2 },
  driveBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: C.surface,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  driveBadgeText: { fontSize: 9, color: C.muted, fontWeight: "500", letterSpacing: 0.3 },
});
