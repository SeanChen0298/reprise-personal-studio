import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../lib/supabase";

// Required for expo-auth-session redirects on Android
WebBrowser.maybeCompleteAuthSession();

export function AuthScreen() {
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "reprise://auth/callback",
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      Alert.alert("Sign In Error", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {/* Logo mark */}
        <View style={styles.logoWrap}>
          <Text style={styles.logoText}>R</Text>
        </View>

        <Text style={styles.title}>Reprise</Text>
        <Text style={styles.subtitle}>Return to a passage and make it yours.</Text>

        <TouchableOpacity
          style={styles.googleBtn}
          onPress={signInWithGoogle}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#374151" />
          ) : (
            <>
              {/* Google "G" colours — simplified as coloured dots */}
              <View style={styles.googleIcon}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#4285F4" }}>G</Text>
              </View>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.legal}>
          Sign in to access your synced song library.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  inner: { alignItems: "center", paddingHorizontal: 32, width: "100%" },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoText: { fontSize: 32, fontWeight: "700", color: "#fff" },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#94A3B8", marginBottom: 40, textAlign: "center" },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  googleIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  googleBtnText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  legal: { fontSize: 11.5, color: "#475569", marginTop: 24, textAlign: "center" },
});
