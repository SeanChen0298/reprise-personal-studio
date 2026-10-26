// Entry: the Play all service (lock screen / notification controls) has to be registered before the app starts.
import TrackPlayer from "react-native-track-player";
import { playbackService } from "./src/lib/radio";
import "expo-router/entry";

TrackPlayer.registerPlaybackService(() => playbackService);
