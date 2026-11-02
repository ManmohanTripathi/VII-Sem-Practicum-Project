import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, View } from "react-native";
import { autoFixServerUrl, clearSession, getSession, Session, setLanguagePreference } from "./src/api";
import { getStoredLang, Lang, storeLang } from "./src/i18n";
import { SetupScreen } from "./src/screens/SetupScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { RemindersScreen } from "./src/screens/RemindersScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { CaregiverScreen } from "./src/screens/CaregiverScreen";
import { colors } from "./src/ui/theme";

type PatientScreen = "home" | "reminders" | "chat" | "settings";

const PREFS_KEY = "carecircle:prefs";

// One app, two sides: the patient side (Saathi, reminders, help) and the caretaker side (family,
// alerts, conversation summaries). The side and language are chosen on first launch.
export default function App() {
  const [session, setSessionState] = useState<Session | null | undefined>(undefined);
  const [lang, setLangState] = useState<Lang>("en");
  const [screen, setScreen] = useState<PatientScreen>("home");
  const [largeText, setLargeText] = useState(false);
  const [readAloud, setReadAloud] = useState(true);

  const check = useCallback(async () => {
    setSessionState(await getSession());
  }, []);

  useEffect(() => {
    getStoredLang().then((l) => l && setLangState(l));
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        setLargeText(!!p.largeText);
        setReadAloud(p.readAloud !== false);
      })
      .catch(() => {});
    // Fix a stale server address (e.g. after changing Wi-Fi) before loading anything.
    autoFixServerUrl()
      .catch(() => {})
      .finally(check);
  }, [check]);

  const savePrefs = (next: { largeText: boolean; readAloud: boolean }) => {
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const changeLang = useCallback(
    async (next: Lang) => {
      setLangState(next);
      await storeLang(next);
      // Patients' language also drives the companion and spoken reminders on the server.
      if (session?.role === "senior") setLanguagePreference(next).catch(() => {});
    },
    [session]
  );

  const handleSwitchProfile = useCallback(async () => {
    await clearSession();
    setScreen("home");
    setSessionState(null);
  }, []);

  const goHome = () => setScreen("home");

  let content: React.ReactNode;
  if (session === undefined) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  } else if (!session) {
    content = <SetupScreen lang={lang} onLang={changeLang} onDone={check} />;
  } else if (session.role === "caregiver") {
    content = <CaregiverScreen name={session.caregiver.name} lang={lang} onLang={changeLang} onSignOut={handleSwitchProfile} />;
  } else if (screen === "chat") {
    content = <ChatScreen lang={lang} onBack={goHome} />;
  } else if (screen === "reminders") {
    content = <RemindersScreen lang={lang} largeText={largeText} onBack={goHome} />;
  } else if (screen === "settings") {
    content = (
      <SettingsScreen
        lang={lang}
        largeText={largeText}
        readAloud={readAloud}
        onBack={goHome}
        onLang={changeLang}
        onLargeText={(v) => {
          setLargeText(v);
          savePrefs({ largeText: v, readAloud });
        }}
        onReadAloud={(v) => {
          setReadAloud(v);
          savePrefs({ largeText, readAloud: v });
        }}
        onSwitchProfile={handleSwitchProfile}
      />
    );
  } else {
    content = <HomeScreen lang={lang} largeText={largeText} readAloud={readAloud} onOpen={setScreen} onSwitchProfile={handleSwitchProfile} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
