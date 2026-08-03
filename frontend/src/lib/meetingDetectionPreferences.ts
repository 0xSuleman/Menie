import { Store } from "@tauri-apps/plugin-store";

export const supportedMeetingApps = [
  { id: "zoom", name: "Zoom" },
  { id: "teams", name: "Microsoft Teams" },
  { id: "webex", name: "Webex" },
  { id: "slack", name: "Slack" },
] as const;

export type MeetingDetectionPreferences = {
  promptOnDetection: boolean;
  enabledApps: Record<string, boolean>;
  autoStartApps: Record<string, boolean>;
  autoStopApps: Record<string, boolean>;
  autoStartCountdownSeconds: number;
  autoStopGraceSeconds: number;
};

export const defaultMeetingDetectionPreferences: MeetingDetectionPreferences = {
  promptOnDetection: true,
  enabledApps: { zoom: true, teams: true, webex: true, slack: false },
  autoStartApps: {},
  autoStopApps: {},
  autoStartCountdownSeconds: 5,
  autoStopGraceSeconds: 90,
};

const STORE_NAME = "preferences.json";
const KEY = "meeting_detection_preferences";

export async function loadMeetingDetectionPreferences(): Promise<MeetingDetectionPreferences> {
  const store = await Store.load(STORE_NAME);
  const saved = await store.get<Partial<MeetingDetectionPreferences>>(KEY);
  return {
    ...defaultMeetingDetectionPreferences,
    ...saved,
    enabledApps: {
      ...defaultMeetingDetectionPreferences.enabledApps,
      ...saved?.enabledApps,
    },
    autoStartApps: {
      ...defaultMeetingDetectionPreferences.autoStartApps,
      ...saved?.autoStartApps,
    },
    autoStopApps: {
      ...defaultMeetingDetectionPreferences.autoStopApps,
      ...saved?.autoStopApps,
    },
  };
}

export async function saveMeetingDetectionPreferences(
  preferences: MeetingDetectionPreferences,
): Promise<void> {
  const store = await Store.load(STORE_NAME);
  await store.set(KEY, preferences);
  await store.save();
}
