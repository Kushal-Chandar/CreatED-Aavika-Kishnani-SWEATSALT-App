import { useState } from "react";
import { useThemeEditor, type CardConfig, type ThemeConfig } from "./ThemeContext";

const SOURCES = ["heatIndex", "gsr", "hr", "temp", "imu"];
const SIZES: CardConfig["size"][] = ["large", "small"];

async function saveTheme(theme: ThemeConfig): Promise<void> {
  await fetch("/__theme/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(theme),
  });
}

const fieldClass =
  "w-full min-w-0 box-border bg-white/6 text-inherit border border-white/20 rounded-md px-1.5 py-1.5 font-sans text-[0.78rem]";

export function ThemeEditorPanel() {
  const [theme, setTheme] = useThemeEditor();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateCard(index: number, patch: Partial<CardConfig>) {
    const cards = theme.cards.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setTheme({ ...theme, cards });
  }

  function updateColor(key: keyof ThemeConfig["colors"], value: string) {
    setTheme({ ...theme, colors: { ...theme.colors, [key]: value } });
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await saveTheme(theme);
    setSaving(false);
    setSaved(true);
  }

  if (!open) {
    return (
      <button
        className="bg-surface border-hairline fixed right-4 bottom-4 z-50 rounded-full border px-4 py-2 font-sans text-[0.85rem] text-[#ede6d6]"
        onClick={() => setOpen(true)}
      >
        Edit theme
      </button>
    );
  }

  return (
    <div className="bg-surface border-hairline fixed right-4 bottom-4 left-4 z-50 ml-auto flex max-h-[min(80vh,640px)] w-[min(360px,100%)] flex-col rounded-xl border font-sans text-[0.85rem] text-[#ede6d6] shadow-2xl max-[420px]:right-3 max-[420px]:bottom-3 max-[420px]:left-3 max-[420px]:w-auto">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3.5 font-semibold">
        <span>Theme editor</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-medium tracking-wide text-white/55 uppercase">
          dev only
        </span>
        <button
          className="ml-auto rounded-md px-2 py-1 text-xl leading-none hover:bg-white/10"
          onClick={() => setOpen(false)}
          aria-label="Close theme editor"
        >
          ×
        </button>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 pt-3.5 pb-1">
        <section>
          <h3 className="mb-2 text-[0.65rem] font-semibold tracking-wider text-white/50 uppercase">Colors</h3>
          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-[0.7rem] text-white/70">Background</span>
              <input
                type="color"
                className="h-7 w-full cursor-pointer rounded-md border border-white/25 bg-transparent p-0"
                value={theme.colors.background}
                onChange={(e) => updateColor("background", e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-[0.7rem] text-white/70">Text</span>
              <input
                type="color"
                className="h-7 w-full cursor-pointer rounded-md border border-white/25 bg-transparent p-0"
                value={theme.colors.text}
                onChange={(e) => updateColor("text", e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-[0.7rem] text-white/70">Accent</span>
              <input
                type="color"
                className="h-7 w-full cursor-pointer rounded-md border border-white/25 bg-transparent p-0"
                value={theme.colors.accent}
                onChange={(e) => updateColor("accent", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[0.65rem] font-semibold tracking-wider text-white/50 uppercase">Cards</h3>
          <div className="flex flex-col gap-2">
            {theme.cards.map((card, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_3.2rem_auto] items-center gap-1.5">
                <select
                  className={fieldClass}
                  value={card.source}
                  onChange={(e) => updateCard(index, { source: e.target.value })}
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  className={fieldClass}
                  value={card.size}
                  onChange={(e) => updateCard(index, { size: e.target.value as CardConfig["size"] })}
                >
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  className={fieldClass}
                  type="number"
                  aria-label="Order"
                  value={card.order}
                  onChange={(e) => updateCard(index, { order: Number(e.target.value) })}
                />
                <label className="flex items-center gap-1.5 text-[0.72rem] whitespace-nowrap text-white/75">
                  <input
                    type="checkbox"
                    checked={card.visible}
                    onChange={(e) => updateCard(index, { visible: e.target.checked })}
                  />
                  <span>visible</span>
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex-shrink-0 px-4 pt-3 pb-4">
        <button
          className="w-full rounded-lg border border-white/30 bg-white/10 px-3 py-2.5 font-sans text-[0.85rem] font-semibold text-[#ede6d6] hover:enabled:bg-white/18 disabled:cursor-default disabled:opacity-60"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save to theme.json"}
        </button>
      </div>
    </div>
  );
}
