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
      // Pinned songs first
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

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Songs</Text>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={songs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={songs.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor="#3B82F6"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No songs yet</Text>
            <Text style={styles.emptySubtitle}>
              Add songs on the desktop app, then sync them here via Google Drive.
            </Text>
          </View>
        }
        renderItem={({ item: song }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/song/${song.id}`)}
            activeOpacity={0.7}
          >
            {/* Thumbnail */}
            <View style={styles.thumb}>
              {song.thumbnail_url ? (
                <Image source={{ uri: song.thumbnail_url }} style={styles.thumbImg} />
              ) : (
                <View style={styles.thumbPlaceholder}>
                  <Text style={styles.thumbPlaceholderText}>♫</Text>
                </View>
              )}
            </View>

            {/* Info */}
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>{song.title}</Text>
              <Text style={styles.cardArtist} numberOfLines={1}>{song.artist}</Text>
              {/* Drive sync badge */}
              {(song.drive_audio_file_id ||
                song.drive_vocals_file_id ||
                song.drive_instrumental_file_id) && (
                <View style={styles.driveBadge}>
                  <Text style={styles.driveBadgeText}>Drive synced</Text>
                </View>
              )}
            </View>

            {/* Mastery */}
            <MasteryRing value={song.mastery} />

            {/* Chevron */}
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function MasteryRing({ value }: { value: number }) {
  const size = 36;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const filled = (value / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* SVG is not natively available in RN without a library — use a simple View ring */}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: "#E2E8F0",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: "700", color: "#3B82F6" }}>
          {value}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#0F172A" },
  errorBanner: {
    margin: 16,
    padding: 12,
    backgroundColor: "#FEE2E2",
    borderRadius: 8,
  },
  errorText: { fontSize: 13, color: "#B91C1C" },
  list: { paddingVertical: 8 },
  emptyList: { flex: 1 },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#475569", marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: "#94A3B8", textAlign: "center", lineHeight: 20 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 10,
  },
  thumb: { width: 48, height: 48, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
  thumbImg: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPlaceholderText: { fontSize: 20 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontWeight: "600", color: "#0F172A" },
  cardArtist: { fontSize: 12, color: "#64748B", marginTop: 2 },
  driveBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  driveBadgeText: { fontSize: 10, color: "#2563EB", fontWeight: "500" },
  chevron: { fontSize: 22, color: "#CBD5E1", marginLeft: 2 },
});
