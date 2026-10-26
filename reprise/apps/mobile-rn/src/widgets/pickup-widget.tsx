// Home-screen widget "Pick up": the song you were last working on, in its colors.
//   ▶ plays it right away (no need to open the app) and carries on with Play all; ⏭ next.
//   While playing: what's playing and the lyric line being sung.
//   Otherwise: something to remember (your note on a line, or a coach tip) — a different one each day.
//   "Sing from Chorus 2" opens the song straight into a sung-along take from where you stopped.
//   The songs before it, as small tiles.
//
// The app writes what to show to widget.json (documents folder) when it changes; Play all's
// service writes widget-live.json while playing. The widget (drawn from a headless JS task)
// only reads those small files.
import * as FileSystem from "expo-file-system";
import TrackPlayer, { State } from "react-native-track-player";
import { FlexWidget, ImageWidget, SvgWidget, TextWidget, requestWidgetUpdate, type WidgetTaskHandlerProps } from "react-native-android-widget";

export const PICKUP_WIDGET = "Pickup";
const FILE = `${FileSystem.documentDirectory}widget.json`;
const LIVE_FILE = `${FileSystem.documentDirectory}widget-live.json`;

type Hex = `#${string}`;

export interface WidgetSong {
  id: string;
  title: string;
  artist: string;
  /** Artwork: a file on the phone, or the YouTube image. */
  image?: string;
  /** The song's deep gradient. */
  top: string;
  bottom: string;
}

export interface PickupData extends WidgetSong {
  /** "Pick up where you left off" / "Start here". */
  label: string;
  /** Today's thing to remember: the words, and the lyric it's about (if any). */
  remember?: { text: string; line?: string };
  /** The sung-along shortcut. */
  sing: { label: string; uri: string };
  recent: WidgetSong[];
}

/** Play all, as the widget shows it. */
export interface LiveData extends WidgetSong {
  playing: boolean;
  lyric?: string;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    if (!(await FileSystem.getInfoAsync(file)).exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(file)) as T;
  } catch {
    return null;
  }
}

export const readPickup = () => readJson<PickupData>(FILE);
export const readLive = () => readJson<LiveData>(LIVE_FILE);

export async function writePickup(d: PickupData | null): Promise<void> {
  if (d) await FileSystem.writeAsStringAsync(FILE, JSON.stringify(d));
  else await FileSystem.deleteAsync(FILE, { idempotent: true });
}

export async function writeLive(d: LiveData | null): Promise<void> {
  if (d) await FileSystem.writeAsStringAsync(LIVE_FILE, JSON.stringify(d));
  else await FileSystem.deleteAsync(LIVE_FILE, { idempotent: true });
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="7 4 20 12 7 20" fill="#FFFFFF"/></svg>',
  pause: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="4" width="4" height="16" rx="1" fill="#FFFFFF"/><rect x="14" y="4" width="4" height="16" rx="1" fill="#FFFFFF"/></svg>',
  next: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="5 4 15 12 5 20" fill="#FFFFFF"/><rect x="17" y="5" width="2.6" height="14" rx="1" fill="#FFFFFF"/></svg>',
  mic: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="2" width="6" height="12" rx="3" fill="#FFFFFF"/><path d="M5 11a7 7 0 0014 0M12 18v4" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
};

function Round({ svg, action, data, size = 40, filled }: { svg: string; action: string; data?: Record<string, unknown>; size?: number; filled?: boolean }) {
  return (
    <FlexWidget
      clickAction={action}
      clickActionData={data}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: filled ? "#FFFFFF33" : "#00000000", alignItems: "center", justifyContent: "center", marginLeft: 6 }}
    >
      <SvgWidget svg={svg} style={{ width: size * 0.46, height: size * 0.46 }} />
    </FlexWidget>
  );
}

export function PickupWidget({ d, live, width, height }: { d: PickupData | null; live: LiveData | null; width: number; height: number }) {
  if (!d && !live) {
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
  // What the top shows: the song playing (Play all), else the one to pick up.
  const song: WidgetSong = live ?? d!;
  const playing = !!live?.playing;
  const art = height > 150 ? 58 : 48;
  const tall = height >= 165 && !!d;
  const recent = tall ? (d?.recent ?? []).filter((r) => r.id !== song.id).slice(0, Math.max(0, Math.floor((width - 190) / 52))) : [];

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `reprise://song/${song.id}` }}
      style={{ height: "match_parent", width: "match_parent", borderRadius: 24, backgroundGradient: { from: song.top as Hex, to: song.bottom as Hex, orientation: "TL_BR" }, padding: 14 }}
    >
      {/* The song, with play / next */}
      <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center" }}>
        {!!song.image && (
          // file:// images are read by the native side even though the type lists only http / data.
          <ImageWidget image={song.image as `https:${string}`} imageWidth={art} imageHeight={art} radius={12} style={{ marginRight: 12 }} />
        )}
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={playing ? "Playing" : live ? "Paused" : d!.label} style={{ fontSize: 11, color: "#FFFFFF99" }} maxLines={1} />
          <TextWidget text={song.title} style={{ fontSize: 18, color: "#FFFFFF", fontFamily: "Fraunces_600SemiBold" }} maxLines={1} truncate="END" />
          <TextWidget text={song.artist} style={{ fontSize: 12, color: "#FFFFFFB8" }} maxLines={1} truncate="END" />
        </FlexWidget>
        {/* Starting the player needs the app on screen (Android), so ▶ opens it; once playing, the buttons work from here. */}
        {live ? (
          <Round svg={playing ? ICON.pause : ICON.play} action="TOGGLE" size={44} filled />
        ) : (
          <Round svg={ICON.play} action="OPEN_URI" data={{ uri: `reprise://play?song=${song.id}` }} size={44} filled />
        )}
        {live ? (
          <Round svg={ICON.next} action="NEXT" size={38} />
        ) : (
          <Round svg={ICON.next} action="OPEN_URI" data={{ uri: `reprise://play?song=${d?.recent[0]?.id ?? song.id}` }} size={38} />
        )}
      </FlexWidget>

      {/* The lyric being sung, or something to remember */}
      <FlexWidget style={{ width: "match_parent", flex: 1, justifyContent: "center", paddingTop: 8 }}>
        {live?.lyric ? (
          <TextWidget text={live.lyric} style={{ fontSize: 17, color: "#FFFFFF", fontFamily: "serif" }} maxLines={2} truncate="END" />
        ) : d?.remember && song.id === d.id ? (
          <FlexWidget>
            <TextWidget text={`“${d.remember.text}”`} style={{ fontSize: 13.5, color: "#FFFFFFE6" }} maxLines={2} truncate="END" />
            {!!d.remember.line && <TextWidget text={d.remember.line} style={{ fontSize: 12, color: "#FFFFFF99", fontFamily: "serif", marginTop: 2 }} maxLines={1} truncate="END" />}
          </FlexWidget>
        ) : (
          <TextWidget text="" style={{ fontSize: 1 }} />
        )}
      </FlexWidget>

      {/* Sing along now, and the songs before it */}
      {tall && (
        <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center" }}>
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: d!.sing.uri }}
            style={{ flexDirection: "row", alignItems: "center", height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#FFFFFF26" }}
          >
            <SvgWidget svg={ICON.mic} style={{ width: 15, height: 15, marginRight: 7 }} />
            <TextWidget text={d!.sing.label} style={{ fontSize: 13, color: "#FFFFFF" }} maxLines={1} />
          </FlexWidget>
          <FlexWidget style={{ flex: 1 }} />
          {recent
            .filter((r) => !!r.image)
            .map((r) => (
              <ImageWidget
                key={r.id}
                image={r.image as `https:${string}`}
                imageWidth={40}
                imageHeight={40}
                radius={10}
                clickAction="OPEN_URI"
                clickActionData={{ uri: `reprise://song/${r.id}` }}
                style={{ marginLeft: 8 }}
              />
            ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** widget-live.json, if Play all really is still around (it can't clear the file when the app is killed). */
async function currentLive(): Promise<LiveData | null> {
  const live = await readLive();
  if (!live) return null;
  try {
    const st = (await TrackPlayer.getPlaybackState()).state;
    if (st === State.None || st === State.Stopped || st === State.Error || st === undefined) return null;
    return { ...live, playing: st === State.Playing || st === State.Buffering || st === State.Loading };
  } catch {
    return null;
  }
}

/** Redraw every Pick up widget on the home screen (with fresh data, or what's on file). */
export async function redrawWidgets(d?: PickupData | null, live?: LiveData | null): Promise<void> {
  const data = d === undefined ? await readPickup() : d;
  const now = live === undefined ? await currentLive() : live;
  await requestWidgetUpdate({
    widgetName: PICKUP_WIDGET,
    renderWidget: (info) => <PickupWidget d={data} live={now} width={info.width} height={info.height} />,
  }).catch(() => {});
}

/** Android asks the app to draw the widget, or a button on it was tapped. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== PICKUP_WIDGET) return;
  const draw = async () => {
    const [d, live] = await Promise.all([readPickup(), currentLive()]);
    props.renderWidget(<PickupWidget d={d} live={live} width={props.widgetInfo.width} height={props.widgetInfo.height} />);
  };
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      await draw();
      break;
    case "WIDGET_CLICK": {
      // Loaded lazily: it pulls in the stores, which plain redraws don't need.
      const radio = await import("../lib/radio");
      if (props.clickAction === "TOGGLE") await radio.toggleRadio();
      else if (props.clickAction === "NEXT") await TrackPlayer.skipToNext().catch(() => {});
      await draw();
      break;
    }
    default:
      break;
  }
}
