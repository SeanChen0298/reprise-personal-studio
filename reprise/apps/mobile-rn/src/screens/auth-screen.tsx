import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../lib/supabase";

// Required for expo-auth-session redirects on Android
WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = "reprise://auth/callback";

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Google OAuth ──────────────────────────────────────────────────────────

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: REDIRECT_URI,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("No OAuth URL returned from Supabase");

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URI);

      if (result.type === "success" && result.url) {
        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(result.url);
        if (sessionError) throw sessionError;
        // Auth store picks up the new session via onAuthStateChange
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      Alert.alert("Sign In Error", msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Email / Password ──────────────────────────────────────────────────────

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Missing fields", "Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        Alert.alert(
          "Check your email",
          "We sent a confirmation link. Click it to activate your account, then sign in."
        );
        setMode("signin");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
              <View style={styles.googleIcon}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#4285F4" }}>G</Text>
              </View>
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#64748B"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#64748B"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.emailBtn, loading && styles.btnDisabled]}
          onPress={handleEmailAuth}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.emailBtnText}>
              {mode === "signin" ? "Sign In" : "Create Account"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modeToggle}
          onPress={() => setMode(mode === "signin" ? "signup" : "signin")}
          disabled={loading}
        >
          <Text style={styles.modeToggleText}>
            {mode === "signin"
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
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
  subtitle: { fontSize: 14, color: "#94A3B8", marginBottom: 36, textAlign: "center" },
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 20,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#1E293B" },
  dividerText: { fontSize: 12, color: "#475569" },
  input: {
    width: "100%",
    backgroundColor: "#1E293B",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 14,
    color: "#F1F5F9",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  emailBtn: {
    width: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  emailBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  modeToggle: { marginTop: 16, padding: 8 },
  modeToggleText: { fontSize: 13, color: "#64748B" },
});
