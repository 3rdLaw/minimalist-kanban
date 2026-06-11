import { describe, test, expect, vi } from "vitest";
import { KBSettingTab, DEFAULT_SETTINGS } from "../src/settings";
import { Setting } from "obsidian";
import type { KBSettings } from "../src/settings";

function makeTab(overrides: Partial<KBSettings> = {}) {
  const plugin: any = {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
  const tab = new KBSettingTab({} as any, plugin);
  return { tab, plugin };
}

describe("KBSettingTab", () => {
  test("renders one toggle per setting", () => {
    const { tab } = makeTab();
    tab.display();

    expect(Setting.instances.map((s) => s.name)).toEqual([
      "Show checkboxes",
      "Enter key adds new line",
      "Prepend new cards",
      "Show archive list",
    ]);
    for (const setting of Setting.instances) {
      expect(setting.toggle).not.toBeNull();
    }
  });

  test("initial toggle values reflect the plugin settings", () => {
    const { tab } = makeTab({ showCheckboxes: true, prependCards: true });
    tab.display();

    const values = Setting.instances.map((s) => s.toggle!.value);
    expect(values).toEqual([true, false, true, false]);
  });

  test("changing a toggle updates the setting and persists it", async () => {
    const { tab, plugin } = makeTab();
    tab.display();

    await Setting.instances[1].toggle!.changeHandler!(true);
    expect(plugin.settings.enterNewline).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    await Setting.instances[3].toggle!.changeHandler!(true);
    expect(plugin.settings.showArchive).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });
});
