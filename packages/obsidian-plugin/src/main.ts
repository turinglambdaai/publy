// Publy Obsidian plugin — client A: write in Obsidian, publish through a Publy server.

import { Plugin, Notice, PluginSettingTab, App, Setting, TFile, requestUrl } from "obsidian";
import { renderMarkdown } from "@publy/core";

interface PublySettings {
  server: string;
  apiKey: string;
  account: string;
  mediaDir: string;
}

const DEFAULT_SETTINGS: PublySettings = {
  server: "",
  apiKey: "",
  account: "",
  mediaDir: "",
};

interface PublishResponse {
  mediaId?: string;
  code?: string;
  message?: string;
}

export default class PublyPlugin extends Plugin {
  settings: PublySettings;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon("send", "Publy: publish current note", () => this.publishCurrentNote());

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note",
      callback: () => this.publishCurrentNote(),
    });

    this.addCommand({
      id: "preview-current-note",
      name: "Preview rendered HTML in browser",
      callback: () => this.previewCurrentNote(),
    });

    this.addSettingTab(new PublySettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    /* nothing persistent */
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private currentFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  private async readWithMediaDirs(file: TFile): Promise<string> {
    const raw = await this.app.vault.cachedRead(file);
    return raw;
  }

  private mediaDirs(): string[] {
    const dirs: string[] = [];
    if (this.settings.mediaDir) dirs.push(this.settings.mediaDir);
    // Obsidian attachments often resolve from the vault root
    dirs.push((this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "");
    return dirs.filter(Boolean);
  }

  private async publishCurrentNote(): Promise<void> {
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    if (!this.settings.server || !this.settings.apiKey) {
      new Notice("Publy: configure server and API key in settings first");
      return;
    }
    const raw = await this.readWithMediaDirs(file);
    new Notice("Publy: rendering…");
    try {
      const rendered = renderMarkdown(raw, {
        baseDir: (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "",
        mediaDirs: this.mediaDirs(),
      });
      for (const w of rendered.warnings) console.warn("[publy] " + w);

      // desktop-only: attachments resolve to absolute paths on disk
      const fs = await import("node:fs");
      const payloadAttachments = rendered.attachments.map((a) => ({
        name: a.name,
        data: fs.readFileSync(a.path).toString("base64"),
        contentType: a.contentType,
      }));

      let coverName: string | undefined;
      if (rendered.cover) {
        const existing = rendered.attachments.find((a) => a.path === rendered.cover);
        coverName = existing?.name;
      }

      const res = requestUrl({
        url: new URL("/v1/publish", this.settings.server).toString(),
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.settings.apiKey },
        body: JSON.stringify({
          account: this.settings.account,
          type: rendered.type,
          title: rendered.title || file.basename,
          html: rendered.html,
          images: payloadAttachments,
          cover: coverName,
          author: rendered.meta.author,
        }),
      });
      const body = (await res.json) as PublishResponse;
      if (!res.status || res.status >= 400) {
        new Notice(`Publy: publish failed — ${body.code ?? res.status}: ${body.message ?? ""}`);
        return;
      }
      new Notice(`Publy: draft ready — media ${body.mediaId}`);
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async previewCurrentNote(): Promise<void> {
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    const raw = await this.readWithMediaDirs(file);
    try {
      const rendered = renderMarkdown(raw, {
        baseDir: (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "",
        mediaDirs: this.mediaDirs(),
      });
      const { shell } = await import("electron");
      const os = await import("node:os");
      const fs = await import("node:fs");
      const out = os.tmpdir() + `/publy-preview-${Date.now()}.html`;
      fs.writeFileSync(out, rendered.html);
      shell.openPath(out);
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }
}

class PublySettingTab extends PluginSettingTab {
  plugin: PublyPlugin;

  constructor(app: App, plugin: PublyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Server URL").addText((text) =>
      text.setPlaceholder("http://your-server:8082").setValue(this.plugin.settings.server).onChange(async (v) => {
        this.plugin.settings.server = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("API key").addText((text) =>
      text.setPlaceholder("x-api-key").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Account").addText((text) =>
      text.setPlaceholder("account name on the server").setValue(this.plugin.settings.account).onChange(async (v) => {
        this.plugin.settings.account = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Media directory").addText((text) =>
      text.setPlaceholder("absolute path to attachment folder").setValue(this.plugin.settings.mediaDir).onChange(async (v) => {
        this.plugin.settings.mediaDir = v;
        await this.plugin.saveSettings();
      }),
    );
  }
}
