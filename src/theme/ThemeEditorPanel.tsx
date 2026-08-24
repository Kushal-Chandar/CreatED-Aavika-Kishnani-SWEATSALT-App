import { useState } from "react";
import { useThemeEditor, type CardConfig, type ThemeConfig } from "./ThemeContext";
import "./theme-editor.css";

const SOURCES = ["heatIndex", "gsr", "hr", "temp", "imu"];
const SIZES: CardConfig["size"][] = ["large", "small"];

async function saveTheme(theme: ThemeConfig): Promise<void> {
  await fetch("/__theme/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(theme),
  });
}

export function ThemeEditorPanel() {
  const [theme, setTheme] = useThemeEditor();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateCard(index: number, patch: Partial<CardConfig>) {
    const cards = theme.cards.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setTheme({ ...theme, cards });
  }

  function updateColor(key: keyof ThemeConfig["colors"], value: string) {
    setTheme({ ...theme, colors: { ...theme.colors, [key]: value } });
  }

  async function handleSave() {
    setSaving(true);
    await saveTheme(theme);
    setSaving(false);
  }

  if (!open) {
    return (
      <button className="theme-editor__toggle" onClick={() => setOpen(true)}>
        Edit theme
      </button>
    );
  }

  return (
    <div className="theme-editor">
      <div className="theme-editor__header">
        <span>Theme editor (dev only)</span>
        <button onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="theme-editor__section">
        <label>
          Background
          <input
            type="color"
            value={theme.colors.background}
            onChange={(e) => updateColor("background", e.target.value)}
          />
        </label>
        <label>
          Text
          <input type="color" value={theme.colors.text} onChange={(e) => updateColor("text", e.target.value)} />
        </label>
        <label>
          Accent
          <input type="color" value={theme.colors.accent} onChange={(e) => updateColor("accent", e.target.value)} />
        </label>
      </div>

      <div className="theme-editor__section">
        {theme.cards.map((card, index) => (
          <div key={index} className="theme-editor__card-row">
            <select value={card.source} onChange={(e) => updateCard(index, { source: e.target.value })}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={card.size}
              onChange={(e) => updateCard(index, { size: e.target.value as CardConfig["size"] })}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input type="number" value={card.order} onChange={(e) => updateCard(index, { order: Number(e.target.value) })} />
            <label>
              <input
                type="checkbox"
                checked={card.visible}
                onChange={(e) => updateCard(index, { visible: e.target.checked })}
              />
              visible
            </label>
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save to theme.json"}
      </button>
    </div>
  );
}
