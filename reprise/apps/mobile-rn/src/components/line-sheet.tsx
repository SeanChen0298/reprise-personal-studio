// Long-press a line: your note on it, your voice mark (register / placement), loop it.
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "./text";
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
          <Pressable key={v} onPress={() => set(on ? null : v)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? t.voiceSoft : t.bg, borderWidth: 1, borderColor: on ? t.voice : t.borderSubtle }}>
            <Text style={{ fontSize: 13.5, color: on ? t.voice : t.textSecondary }}>{v}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const label = { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: t.muted, textTransform: "uppercase", marginBottom: 7 } as const;

  return (
    <Sheet open={!!line} onClose={close} title={`Line ${lineNo}`} t={t}>
      {line && (
        <View style={{ gap: 18 }}>
          <Text style={{ fontFamily: "serif", fontSize: 19, color: t.text, lineHeight: 26 }}>{line.custom_text ?? line.text}</Text>
          <View>
            <Text style={label}>My note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. breathe before this, darker sound"
              placeholderTextColor={t.muted}
              multiline
              style={{ minHeight: 64, borderWidth: 1.5, borderColor: t.border, borderRadius: 10, padding: 10, fontSize: 15, color: t.text, backgroundColor: t.bg, textAlignVertical: "top" }}
            />
          </View>
          <View>
            <Text style={label}>Register</Text>
            {chips(REGISTERS, register, setRegister)}
          </View>
          <View>
            <Text style={label}>Placement</Text>
            {chips(PLACEMENTS, placement, setPlacement)}
          </View>
          <Pressable onPress={() => { onLoop(); close(); }} style={{ alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: t.themeSoft }}>
            <Text style={{ color: t.themeText, fontSize: 14, fontWeight: "600" }}>Loop this line</Text>
          </Pressable>
          <Text style={{ fontSize: 12, color: t.muted }}>Notes and voice marks go to your computer on the next sync.</Text>
        </View>
      )}
    </Sheet>
  );
}
