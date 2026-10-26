// react-native-track-player 4.1.2 on the new architecture: the interop layer can't parse
// @ReactMethods whose expression body returns a coroutine Job (`fun play(...) = scope.launch {…}`),
// so the app crashes at start. Wrap the scope so `launch` returns Unit. Runs after npm install.
const fs = require("fs");
const path = require("path");

const file = path.join(
  __dirname,
  "../node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt",
);
if (!fs.existsSync(file)) process.exit(0);
let s = fs.readFileSync(file, "utf8");
if (s.includes("class UnitScope")) process.exit(0);

const swap = (a, b) => {
  if (!s.includes(a)) throw new Error(`patch-track-player: "${a}" not found — check the new version`);
  s = s.replace(a, b);
};
swap("    private val scope = MainScope()", "    // Interop can't parse @ReactMethods returning a Job, so launch returns Unit.\n    private val scope = UnitScope(MainScope())");
swap("import kotlinx.coroutines.MainScope", "import kotlinx.coroutines.CoroutineScope\nimport kotlinx.coroutines.MainScope");
s = `${s.trimEnd()}\n\nclass UnitScope(private val inner: CoroutineScope) {\n    fun launch(block: suspend CoroutineScope.() -> Unit) {\n        inner.launch(block = block)\n    }\n}\n`;
fs.writeFileSync(file, s);
console.log("patch-track-player: patched MusicModule.kt");
