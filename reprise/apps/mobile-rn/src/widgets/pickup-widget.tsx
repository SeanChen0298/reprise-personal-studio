// Home-screen widget "Pick up": the song you were last working on, in its colors, with one
// thing the coach suggested working on. Tap → the song.
//
// The app writes what to show to widget.json (documents folder) whenever it changes; the widget
// (drawn by Android from a headless JS task) only reads that small file.
import * as FileSystem from "expo-file-system";
import { FlexWidget, ImageWidget, TextWidget, type WidgetTaskHandlerProps } from "react-native-android-widget";

export const PICKUP_WIDGET = "Pickup";
const FILE = `${FileSystem.documentDirectory}widget.json`;

export interface PickupData {
  songId: string;
  title: string;
  artist: string;
  /** "Pick up where you left off" / "Start here". */
  label: string;
  /** One thing to work on (from the coach's card), if any. */
  focus?: string;
  /** Background gradient (the song's Vivid colors). */
  top: string;
  bottom: string;
  /** Artwork: a file on the phone, or the YouTube image. */
  image?: string;
}

export async function readPickup(): Promise<PickupData | null> {
  try {
    if (!(await FileSystem.getInfoAsync(FILE)).exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(FILE)) as PickupData;
  } catch {
    return null;
  }
}

export async function writePickup(d: PickupData | null): Promise<void> {
  if (d) await FileSystem.writeAsStringAsync(FILE, JSON.stringify(d));
  else await FileSystem.deleteAsync(FILE, { idempotent: true });
}

export function PickupWidget({ d, width, height }: { d: PickupData | null; width: number; height: number }) {
  if (!d) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{ height: "match_parent", width: "match_parent", borderRadius: 24, backgroundGradient: { from: "#2A2A38", to: "#121218", orientation: "TL_BR" }, padding: 18, justifyContent: "center" }}
      >
        <TextWidget text="Reprise" style={{ fontSize: 20, color: "#FFFFFF", fontFamily: "Fraunces_600SemiBold" }} />
        <TextWidget text="Open the app and pair with your computer to see your songs here." style={{ fontSize: 13, color: "#FFFFFFB0", marginTop: 6 }} maxLines={3} />
      </FlexWidget>
    );
  }
  const art = Math.min(height - 36, width * 0.36);
  const wide = width > 230;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `reprise://song/${d.songId}` }}
      style={{
        height: "match_parent",
        width: "match_parent",
        borderRadius: 24,
        backgroundGradient: { from: d.top as `#${string}`, to: d.bottom as `#${string}`, orientation: "TL_BR" },
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {wide && !!d.image && (
        // file:// images are read by the native side even though the type lists only http / data.
        <ImageWidget image={d.image as `https:${string}`} imageWidth={art} imageHeight={art} radius={18} style={{ marginRight: 14 }} />
      )}
      <FlexWidget style={{ flex: 1, height: "match_parent", justifyContent: "center" }}>
        <TextWidget text={d.label} style={{ fontSize: 11.5, color: "#FFFFFFA8" }} maxLines={1} />
        <TextWidget text={d.title} style={{ fontSize: 21, color: "#FFFFFF", fontFamily: "Fraunces_600SemiBold", marginTop: 2 }} maxLines={1} truncate="END" />
        <TextWidget text={d.artist} style={{ fontSize: 13, color: "#FFFFFFC0" }} maxLines={1} truncate="END" />
        {!!d.focus && height > 120 && <TextWidget text={d.focus} style={{ fontSize: 12.5, color: "#FFFFFFE0", marginTop: 8 }} maxLines={2} truncate="END" />}
      </FlexWidget>
    </FlexWidget>
  );
}

/** Android asks the app to draw the widget (added / resized / periodic update). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== PICKUP_WIDGET) return;
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      const d = await readPickup();
      props.renderWidget(<PickupWidget d={d} width={props.widgetInfo.width} height={props.widgetInfo.height} />);
      break;
    }
    default:
      break;
  }
}
