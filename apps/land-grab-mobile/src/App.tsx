import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { landGrabHtml } from "./generated/landGrabHtml";

const gameServerUrl = process.env.EXPO_PUBLIC_LAND_GRAB_SERVER_URL?.trim();

export function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const injectedConfig = useMemo(
    () =>
      `window.__LAND_GRAB_CONFIG__ = ${JSON.stringify({
        gameServerUrl: gameServerUrl || undefined,
      })}; true;`,
    [],
  );

  const reload = () => {
    setError(null);
    setLoading(true);
    setReloadKey((value) => value + 1);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar hidden />
      <WebView
        key={reloadKey}
        source={{ html: landGrabHtml, baseUrl: "https://land-grab.local/" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={injectedConfig}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setError(event.nativeEvent.description);
        }}
        style={styles.webView}
      />
      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.message}>Loading offline practice…</Text>
        </View>
      )}
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.title}>LandGrab could not load</Text>
          <Text style={styles.message}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.button}>
            <Text style={styles.buttonText}>Reload</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#020617" },
  webView: { flex: 1, backgroundColor: "#020617" },
  overlay: {
    alignItems: "center",
    backgroundColor: "#020617",
    bottom: 0,
    gap: 12,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  title: { color: "#f8fafc", fontSize: 22, fontWeight: "700" },
  message: { color: "#94a3b8", textAlign: "center" },
  button: {
    backgroundColor: "#0284c7",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
