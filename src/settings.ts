import { App, PluginSettingTab, Setting } from "obsidian";
import type KanbanBoardPlugin from "./main";

export interface KBSettings {
  showCheckboxes: boolean;
  enterNewline: boolean;
  prependCards: boolean;
}

export const DEFAULT_SETTINGS: KBSettings = {
  showCheckboxes: false,
  enterNewline: false,
  prependCards: false,
};

export class KBSettingTab extends PluginSettingTab {
  plugin: KanbanBoardPlugin;

  constructor(app: App, plugin: KanbanBoardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show checkboxes")
      .setDesc(
        "Display checkboxes on cards that have them in the markdown."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCheckboxes)
          .onChange(async (value) => {
            this.plugin.settings.showCheckboxes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enter key adds new line")
      .setDesc(
        "When enabled, Enter adds a new line in card text and Shift+Enter submits. " +
          "When disabled, Enter submits and Shift+Enter adds a new line."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enterNewline)
          .onChange(async (value) => {
            this.plugin.settings.enterNewline = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Prepend new cards")
      .setDesc(
        "Add new cards to the top of the list instead of the bottom."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.prependCards)
          .onChange(async (value) => {
            this.plugin.settings.prependCards = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
