// Long-press a line: your note on it, your voice mark (register / placement), loop it.
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "./text";
import { PressableScale } from "./pressable-scale";
import { Button } from "./ui";
import { PLACEMENTS, REGISTERS, type Line } from "@reprise/shared/core";
import { Sheet } from "./sheet";
import type { Theme } from "../lib/theme";

interface Props {
  line: Line | null;
  lineNo: number;
  t: Theme;
  onClose: () => void;
  onSave: (patch: { note: string | null; register: string | null; placement: string | null }) => void;
  onLoop: () => void;
}

export function LineSheet({ line, lineNo, t, onClose, onSave, onLoop }: Props) {
  const [note, setNote] = useState("");
  const [register, setRegister] = useState<string | null>(null);
  const [placement, setPlacement] = useState<string | null>(null);

  useEffect(() => {
    setNote(line?.note ?? "");
    setRegister(line?.register ?? null);
    setPlacement(line?.placement ?? null);
  }, [line]);

  const close = () => {
    if (line) {
      const n = note.trim() || null;
      if (n !== (line.note ?? null) || register !== (line.register ?? null) || placement !== (line.placement ?? null)) {
        onSave({ note: n, register, placement });
      }
    }
    onClose();
  };

  const chips = (values: readonly string[], value: string | null, set: (v: string | null) => void) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {values.map((v) => {
        const on = v === value;
        return (
          <PressableScale key={v} haptic scaleTo={0.92} onPress={() => set(on ? null : v)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? t.voiceSoft : (t.dark ? "#FFFFFF0D" : "#0000000A") }}>
            <Text style={{ fontSize: 14, fontWeight: on ? "600" : "400", color: on ? t.voice : t.textSecondary }}>{v}</Text>
          </PressableScale>
        );
      })}
    </View>
  );

  const label = { fontSize: 11, fontWeight: "600", letterSpacing: 1.1, color: t.muted, textTransform: "uppercase", marginBottom: 8 } as const;

  return (
    <Sheet open={!!line} onClose={close} title="This line" t={t}>
      {line && (
        <View style={{ gap: 18 }}>
          <Text style={{ fontFamily: "serif", fontSize: 21, color: t.text, lineHeight: 29 }}>{line.custom_text ?? line.text}</Text>
          <View>
            <Text style={label}>Your note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. breathe before this, darker sound"
              placeholderTextColor={t.muted}
              multiline
              style={{ minHeight: 68, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: t.text, backgroundColor: (t.dark ? "#FFFFFF0D" : "#0000000A"), textAlignVertical: "top", fontFamily: "Inter_400Regular" }}
            />
          </View>
          <View>
            <Text style={label}>Your voice here</Text>
            {chips(REGISTERS, register, setRegister)}
          </View>
          <View>
            <Text style={label}>Where it sits</Text>
            {chips(PLACEMENTS, placement, setPlacement)}
          </View>
          <Button
            t={t}
            kind="soft"
            label="Loop this line"
            style={{ alignSelf: "flex-start" }}
            onPress={() => {
              onLoop();
              close();
            }}
          />
          <Text style={{ fontSize: 12, color: t.muted }}>Notes and voice marks go to your computer a few seconds later (whenever it's reachable).</Text>
        </View>
      )}
    </Sheet>
  );
}
