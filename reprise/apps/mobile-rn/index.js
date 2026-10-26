// Entry: the Play all service (lock screen / notification controls) and the home-screen widget's
// task have to be registered before the app starts (both also run without the app open).
import TrackPlayer from "react-native-track-player";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { playbackService } from "./src/lib/radio";
import { widgetTaskHandler } from "./src/widgets/pickup-widget";
import "expo-router/entry";

TrackPlayer.registerPlaybackService(() => playbackService);
registerWidgetTaskHandler(widgetTaskHandler);
