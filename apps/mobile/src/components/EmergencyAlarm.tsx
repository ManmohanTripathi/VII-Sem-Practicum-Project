import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Icon } from "../ui/Icon";

export type Emergency = { alertId: string; elderId: string; elderName: string; message: string; phone?: string | null; count: number };

const SIREN = require("../../assets/sounds/emergency.wav");
// Buzz, pause, buzz… repeated until dismissed (iOS uses its own fixed-length buzz for each step).
const PATTERN = [0, 900, 500];

// remove() alone doesn't reliably stop a looping sound on iOS: stop it first, then release it.
function stopSiren(p: AudioPlayer | null) {
  if (!p) return;
  try {
    p.loop = false;
    p.pause();
    p.volume = 0;
  } catch {}
  try {
    p.remove();
  } catch {}
}

// Full-screen alarm for the home hardware's emergency alert: a looping siren that plays even with the
// silent switch on, continuous vibration, until the caretaker taps "I'm on it" or silences it.
export function EmergencyAlarm({
  emergency,
  handledBy,
  onAcknowledge,
  onClose,
}: {
  emergency: Emergency;
  handledBy?: string | null; // someone tapped "I'm on it" on another device
  onAcknowledge: () => Promise<void>;
  onClose: () => void;
}) {
  const player = useRef<AudioPlayer | null>(null);
  const [silenced, setSilenced] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = emergency.elderName.split(" ")[0] || "Your parent";

  const quiet = silenced || !!handledBy;

  useEffect(() => {
    if (quiet) return;
    let cancelled = false;
    Vibration.vibrate(PATTERN, true);
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "doNotMix", allowsRecording: false, shouldRouteThroughEarpiece: false })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        stopSiren(player.current);
        const p = createAudioPlayer(SIREN);
        p.loop = true;
        p.volume = 1;
        p.play();
        player.current = p;
      });
    return () => {
      cancelled = true;
      Vibration.cancel();
      stopSiren(player.current);
      player.current = null;
    };
  }, [quiet, emergency.alertId]);

  async function acknowledge() {
    setBusy(true);
    setSilenced(true);
    Vibration.cancel();
    stopSiren(player.current);
    player.current = null;
    await onAcknowledge().catch(() => {});
    setBusy(false);
    onClose();
  }

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setSilenced(true)}>
      <View style={styles.screen} accessibilityRole="alert">
        <Icon name="warning" size={96} color="#fff" />
        <Text style={styles.title}>EMERGENCY</Text>
        <Text style={styles.subtitle}>at {first}&apos;s home</Text>
        <Text style={styles.message}>{emergency.message}</Text>
        {emergency.count > 1 && <Text style={styles.count}>{emergency.count} alerts from the home device</Text>}
        {handledBy ? <Text style={styles.handled}>✓ {handledBy} is on it</Text> : null}

        <View style={styles.buttons}>
          <Pressable onPress={acknowledge} disabled={busy} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#B91C1C" /> : <Text style={styles.primaryText}>{handledBy ? "OK" : "I'm on it"}</Text>}
          </Pressable>
          {emergency.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${emergency.phone}`)} style={styles.secondary} accessibilityRole="button">
              <Icon name="call" size={22} color="#fff" />
              <Text style={styles.secondaryText}>Call {first}</Text>
            </Pressable>
          ) : null}
          {!quiet && (
            <Pressable onPress={() => setSilenced(true)} style={styles.secondary} accessibilityRole="button">
              <Icon name="volume-mute" size={22} color="#fff" />
              <Text style={styles.secondaryText}>Silence alarm</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#B91C1C", alignItems: "center", justifyContent: "center", padding: 28 },
  title: { color: "#fff", fontSize: 44, fontWeight: "900", letterSpacing: 2, marginTop: 12 },
  subtitle: { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 4 },
  message: { color: "rgba(255,255,255,0.92)", fontSize: 18, textAlign: "center", marginTop: 18, lineHeight: 25 },
  count: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "700", marginTop: 10 },
  handled: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 16, backgroundColor: "rgba(0,0,0,0.2)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, overflow: "hidden" },
  buttons: { alignSelf: "stretch", gap: 12, marginTop: 36 },
  primary: { backgroundColor: "#fff", borderRadius: 20, paddingVertical: 20, alignItems: "center" },
  primaryText: { color: "#B91C1C", fontSize: 22, fontWeight: "900" },
  secondary: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", paddingVertical: 16 },
  secondaryText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
