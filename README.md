# Marked Git Publisher for Obsidian

A desktop Obsidian plugin for publishing **only the notes and folders you mark** to a separate public GitHub repository. The publishing repository stays outside the vault and outside this plugin's source repository. Nothing is selected when the plugin is first installed.

This project is based on [Selective Publisher](https://github.com/Ivan1248/obsidian-selective-publisher) by Ivan Grubišić, under the MIT license. It adds file and folder context menu marking, per-note exclusions inside selected folders, automatic selection updates after rename/delete, optional delayed automatic publishing, and GitHub-friendly links for published notes and images.

## How it works

1. Right-click a note or folder in Obsidian and choose **标记…用于 GitHub 公开同步**. Right-click again to remove it. A note inside a marked folder can be excluded individually.
2. With automatic sync enabled, marking changes publish after about 8 seconds, and edits to marked notes publish about 30 seconds after the last edit. You can also click the paper-plane icon to preview added, changed, and removed files and push manually.
3. The plugin copies selected notes and referenced attachments to the `notes/` directory of a local Git repository, commits those changes, and pushes the selected branch over your existing Git transport (SSH or HTTPS).

The plugin converts Obsidian wiki links to published notes and embedded assets into relative Markdown links. Links to unpublished notes are rendered as plain text. Publishing is **one-way** from Obsidian to GitHub; edits made on GitHub are not imported into the vault. Unmarking a file removes its published copy on the next publish.

**自动同步** is on by default, so marking a note or folder is enough to publish it. Turn it off in settings if you prefer manual preview and publishing. Automatic publishing skips the preview.

## Setup

- Install Git and configure a GitHub remote that can push. A local Git clone must exist outside your Obsidian vault.
- Create a `notes/` directory directly under the repository root.
- Install `main.js`, `manifest.json`, and `styles.css` from the matching [release](https://github.com/Avaivartika/obsidian-marked-git-publisher/releases) into `<vault>/.obsidian/plugins/marked-git-publisher/`, then enable it in Community plugins.
- In the plugin settings, choose the absolute `notes/` path and the target branch. The plugin accepts only a root-level `notes/` directory and refuses a repository inside the Obsidian vault.

The destination repository may contain a README and other files outside `notes/`. The publisher stages and commits only `notes/`. It manages and may delete files **inside `notes/`**, so keep unrelated files elsewhere. Before every manual push, the preview lists all file additions, changes, and deletions.

No GitHub token is stored by this plugin. It invokes local `git` with the machine's existing authentication. No telemetry or other network service is used.

## Development

```sh
npm ci
npm run build
npm run lint
```

The bundled `main.js` is a release artifact and is intentionally not committed to the source branch. The `manifest.json` and `styles.css` source files are in this repository. The original MIT copyright notice remains in [LICENSE](LICENSE).

发布 Markdown 时会自动在发布副本中补充 `created` 字段，取自 Obsidian 文件创建时间（已有字段优先保留），不会改写本地正文。博客可据此按创建时间排序，而不是上传时间。
