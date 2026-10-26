// Home-screen widget "Pick up": the song you practiced most recently, artwork first — its picture
// fills the widget, the song's own color rises over the bottom, the title sits on it. Tap → the song.
//
// The app writes what to show to widget.json (documents folder) when it changes; the widget (drawn
// from a headless JS task) reads that, and cuts the artwork to the widget's shape (Android
// stretches widget images to fit, so they have to arrive the right shape).
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { FlexWidget, ImageWidget, OverlapWidget, TextWidget, requestWidgetUpdate, type WidgetTaskHandlerProps } from "react-native-android-widget";

export const PICKUP_WIDGET = "Pickup";
const FILE = `${FileSystem.documentDirectory}widget.json`;

type Hex = `#${string}`;

export interface PickupData {
  id: string;
  title: string;
  artist: string;
  /** "Pick up where you left off" / "Start here". */
  label: string;
  /** The artwork without letterbox bars, as a file on the phone. */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** The song's deep color (the bottom of its Vivid gradient). */
  deep: string;
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

/** The artwork cut (centered) to the widget's shape, cached per size. */
async function artFor(d: PickupData, w: number, h: number): Promise<string | undefined> {
  if (!d.image || !d.imageWidth || !d.imageHeight) return undefined;
  const out = `${FileSystem.cacheDirectory}widget-${d.id}-${Math.round(w)}x${Math.round(h)}.jpg`;
  try {
    if ((await FileSystem.getInfoAsync(out)).exists) return out;
    const want = w / h;
    const have = d.imageWidth / d.imageHeight;
    const cw = have > want ? Math.round(d.imageHeight * want) : d.imageWidth;
    const ch = have > want ? d.imageHeight : Math.round(d.imageWidth / want);
    const res = await manipulateAsync(
      d.image,
      [{ crop: { originX: Math.round((d.imageWidth - cw) / 2), originY: Math.round((d.imageHeight - ch) / 2), width: cw, height: ch } }, { resize: { width: Math.min(cw, 900) } }],
      { compress: 0.85, format: SaveFormat.JPEG },
    );
    await FileSystem.moveAsync({ from: res.uri, to: out });
    return out;
  } catch {
    return undefined;
  }
}

export async function renderPickup(d: PickupData | null, width: number, height: number) {
  if (!d) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{ height: "match_parent", width: "match_parent", borderRadius: 28, backgroundGradient: { from: "#2A2A38", to: "#121218", orientation: "TL_BR" }, padding: 20, justifyContent: "flex-end" }}
      >
        <TextWidget text="Reprise" style={{ fontSize: 24, color: "#FFFFFF", fontFamily: "Fraunces_600SemiBold" }} />
        <TextWidget text="Open the app and pair with your computer." style={{ fontSize: 13, color: "#FFFFFFB0", marginTop: 4 }} maxLines={2} />
      </FlexWidget>
    );
  }
  const art = await artFor(d, width, height);
  const deep = d.deep as Hex;
  const big = height >= 150;
  return (
    <OverlapWidget clickAction="OPEN_URI" clickActionData={{ uri: `reprise://song/${d.id}` }} style={{ height: "match_parent", width: "match_parent", borderRadius: 28 }}>
      {art ? (
        // file:// images are read by the native side even though the type lists only http / data.
        <ImageWidget image={art as `https:${string}`} imageWidth={width} imageHeight={height} radius={28} />
      ) : (
        <FlexWidget style={{ height: "match_parent", width: "match_parent", borderRadius: 28, backgroundColor: deep }} />
      )}
      {/* The song's color rising over the bottom of its picture, and its name on it */}
      <FlexWidget
        style={{
          height: "match_parent",
          width: "match_parent",
          borderRadius: 28,
          backgroundGradient: { from: `${d.deep}00` as Hex, to: `${d.deep}F5` as Hex, orientation: "TOP_BOTTOM" },
          paddingHorizontal: 20,
          paddingBottom: big ? 18 : 14,
          justifyContent: "flex-end",
        }}
      >
        <TextWidget text={d.label} style={{ fontSize: 11.5, color: "#FFFFFFB3", letterSpacing: 0.04 }} maxLines={1} />
        <TextWidget text={d.title} style={{ fontSize: big ? 30 : 22, color: "#FFFFFF", fontFamily: "Fraunces_600SemiBold", marginTop: 2 }} maxLines={1} truncate="END" />
        <TextWidget text={d.artist} style={{ fontSize: big ? 14 : 12.5, color: "#FFFFFFCC", marginTop: 1 }} maxLines={1} truncate="END" />
      </FlexWidget>
    </OverlapWidget>
  );
}

/** Redraw every Pick up widget on the home screen. */
export async function redrawWidgets(d?: PickupData | null): Promise<void> {
  const data = d === undefined ? await readPickup() : d;
  await requestWidgetUpdate({
    widgetName: PICKUP_WIDGET,
    renderWidget: (info) => renderPickup(data, info.width, info.height),
  }).catch(() => {});
}

/** Android asks the app to draw the widget (added / resized / its periodic update). */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== PICKUP_WIDGET) return;
  if (props.widgetAction === "WIDGET_ADDED" || props.widgetAction === "WIDGET_UPDATE" || props.widgetAction === "WIDGET_RESIZED") {
    props.renderWidget(await renderPickup(await readPickup(), props.widgetInfo.width, props.widgetInfo.height));
  }
}
