import { FileSystemAdapter, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'
import { PublishPreviewModal, PublishAction } from './ui/publish-preview-modal'
import { FailureModal } from './ui/failure-modal'
import { SelectivePublisherSettings, DEFAULT_SETTINGS } from './settings'
import { SelectivePublisherSettingTab } from './ui/settings-tab'
import { GitHelper } from './publishing/git-helper'
import { PublishingService } from './publishing/publishing-service'

export default class SelectivePublisherPlugin extends Plugin {
    settings!: SelectivePublisherSettings
    publishingService!: PublishingService
    private autoTimer: ReturnType<typeof setTimeout> | null = null
    private publishing = false
    private publishAgain = false

    async onload() {
        await this.loadSettings()
        this.publishingService = new PublishingService(this.app, this.settings.repo)
        this.addCommand({ id: 'publish-notes', name: '发布已标记的笔记到 GitHub', callback: () => { void this.publishNotes() } })
        this.addCommand({ id: 'preview-publishable', name: '预览公开同步范围', callback: () => { void this.previewPublishableFiles() } })
        this.addCommand({
            id: 'toggle-current-note', name: '标记或取消公开同步当前笔记',
            checkCallback: checking => {
                const file = this.app.workspace.getActiveFile()
                if (!file) return false
                if (!checking) void this.toggleFile(file)
                return true
            },
        })
        this.addRibbonIcon('paper-plane', '预览并发布已标记笔记', () => { void this.previewPublishableFiles() })
        this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
            if (file instanceof TFolder && file.path !== '/') {
                const selected = this.settings.selectedFolders.includes(file.path)
                menu.addItem(item => item.setTitle(selected ? '移出 GitHub 公开同步' : '标记文件夹用于 GitHub 公开同步')
                    .setIcon(selected ? 'circle-minus' : 'cloud-upload')
                    .onClick(() => { void this.toggleFolder(file) }))
            } else if (file instanceof TFile && file.extension === 'md') {
                const selected = this.isNoteSelected(file.path)
                menu.addItem(item => item.setTitle(selected ? '移出 GitHub 公开同步' : '标记笔记用于 GitHub 公开同步')
                    .setIcon(selected ? 'circle-minus' : 'cloud-upload')
                    .onClick(() => { void this.toggleFile(file) }))
            }
        }))
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.renameSelection(file, oldPath) }))
        this.registerEvent(this.app.vault.on('delete', file => { void this.deleteSelection(file) }))
        this.registerEvent(this.app.vault.on('modify', file => {
            if (file instanceof TFile && (this.isNoteSelected(file.path) || file.extension !== 'md')) this.scheduleAutoPublish()
        }))
        this.registerEvent(this.app.vault.on('create', file => {
            if (file instanceof TFile && this.isNoteSelected(file.path)) this.scheduleAutoPublish()
        }))
        this.register(() => { if (this.autoTimer) clearTimeout(this.autoTimer) })
        this.addSettingTab(new SelectivePublisherSettingTab(this.app, this))
    }

    isNoteSelected(path: string): boolean {
        if (this.settings.excludedFiles.includes(path)) return false
        return this.settings.selectedFiles.includes(path) || this.settings.selectedFolders.some(folder => path.startsWith(folder + '/'))
    }

    async toggleFile(file: TFile): Promise<void> {
        const path = file.path
        const inherited = this.settings.selectedFolders.some(folder => path.startsWith(folder + '/'))
        if (this.settings.excludedFiles.includes(path)) {
            this.settings.excludedFiles = this.settings.excludedFiles.filter(item => item !== path)
        } else if (this.settings.selectedFiles.includes(path)) {
            this.settings.selectedFiles = this.settings.selectedFiles.filter(item => item !== path)
            if (inherited) this.settings.excludedFiles.push(path)
        } else if (inherited) {
            this.settings.excludedFiles.push(path)
        } else {
            this.settings.selectedFiles.push(path)
        }
        await this.saveSettings()
        this.scheduleAutoPublish()
        new Notice(`${this.isNoteSelected(path) ? '已标记' : '已移出'}公开同步：${path}`)
    }

    async toggleFolder(folder: TFolder): Promise<void> {
        const path = folder.path
        if (this.settings.selectedFolders.includes(path)) {
            this.settings.selectedFolders = this.settings.selectedFolders.filter(item => item !== path)
        } else {
            this.settings.selectedFolders.push(path)
        }
        await this.saveSettings()
        this.scheduleAutoPublish()
        new Notice(`${this.settings.selectedFolders.includes(path) ? '已标记' : '已移出'}公开同步：${path}`)
    }

    private async renameSelection(file: TAbstractFile, oldPath: string): Promise<void> {
        const rename = (paths: string[]) => paths.map(path => path === oldPath || (file instanceof TFolder && path.startsWith(oldPath + '/'))
            ? file.path + path.slice(oldPath.length) : path)
        this.settings.selectedFiles = rename(this.settings.selectedFiles)
        this.settings.selectedFolders = rename(this.settings.selectedFolders)
        this.settings.excludedFiles = rename(this.settings.excludedFiles)
        await this.saveSettings()
        this.scheduleAutoPublish()
    }

    private async deleteSelection(file: TAbstractFile): Promise<void> {
        const keep = (path: string) => path !== file.path && !(file instanceof TFolder && path.startsWith(file.path + '/'))
        this.settings.selectedFiles = this.settings.selectedFiles.filter(keep)
        this.settings.selectedFolders = this.settings.selectedFolders.filter(keep)
        this.settings.excludedFiles = this.settings.excludedFiles.filter(keep)
        await this.saveSettings()
        this.scheduleAutoPublish()
    }

    getPublishableFiles(): TFile[] {
        const notes = this.app.vault.getMarkdownFiles().filter(file => this.isNoteSelected(file.path))
        const selected = new Set<TFile>(notes)
        if (this.settings.publishAttachments) {
            for (const note of notes) {
                const metadata = this.app.metadataCache.getFileCache(note)
                for (const link of [...(metadata?.links ?? []), ...(metadata?.embeds ?? [])]) {
                    const target = this.app.metadataCache.getFirstLinkpathDest(link.link.split('#')[0]!, note.path)
                    if (target instanceof TFile && target.extension !== 'md') selected.add(target)
                }
            }
        }
        return [...selected].sort((a, b) => a.path.localeCompare(b.path))
    }

    async previewPublishableFiles() {
        try {
            if (!await this.switchToPublishingBranch()) return
            const files = this.getPublishableFiles()
            const statuses = await this.publishingService.getPublishingStatuses(files)
            const dirty = await GitHelper.hasUncommittedChanges(this.settings.repo)
            if (statuses.length === 0 && !dirty) {
                new Notice('没有待发布或待撤回的文件。')
                return
            }
            new PublishPreviewModal(this.app, statuses, dirty,
                (action: PublishAction) => this.publishNotes({ commitOnly: action === 'commit', skipPreview: true }),
                (path: string) => this.publishingService.getFileDiff(path)).open()
        } catch (error) {
            console.error('Publishing preview failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    async publishNotes({ commitOnly = false, skipPreview = false }: { commitOnly?: boolean, skipPreview?: boolean } = {}) {
        if (this.publishing) {
            this.publishAgain = true
            return
        }
        this.publishing = true
        try {
            if (!skipPreview && this.settings.showPreviewBeforePublishing) {
                await this.previewPublishableFiles()
                return
            }
            if (!await this.switchToPublishingBranch()) return
            new Notice(commitOnly ? '正在提交公开笔记…' : '正在同步公开笔记到 GitHub…')
            if (!commitOnly) await GitHelper.pull(this.settings.repo, this.settings.repoBranch)
            const files = this.getPublishableFiles()
            await this.publishingService.updateFilesInRepo(files)
            await GitHelper.add(this.settings.repo)
            await GitHelper.commit(this.settings.repo, this.settings.commitMessage)
            if (!commitOnly) await GitHelper.push(this.settings.repo, this.settings.repoBranch)
            new Notice(`已${commitOnly ? '提交' : '同步'} ${files.filter(file => file.extension === 'md').length} 篇笔记。`)
        } catch (error) {
            console.error('Publishing failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        } finally {
            this.publishing = false
            if (this.publishAgain) {
                this.publishAgain = false
                this.scheduleAutoPublish()
            }
        }
    }

    scheduleAutoPublish() {
        if (!this.settings.autoPublish) return
        if (this.autoTimer) clearTimeout(this.autoTimer)
        this.autoTimer = setTimeout(() => {
            this.autoTimer = null
            if (this.settings.autoPublish) void this.publishNotes({ skipPreview: true })
        }, 30000)
    }

    private async switchToPublishingBranch(): Promise<boolean> {
        if (!this.settings.repoBranch || this.settings.repo === DEFAULT_SETTINGS.repo) {
            new Notice('请先在插件设置中指定 Git 仓库目录和分支。')
            return false
        }
        const validation = await GitHelper.validateRepo(this.settings.repo)
        if (!validation.isValid) throw new Error(validation.error ?? 'Git 仓库不可用')
        const publishingDirectory = await fs.realpath(this.settings.repo)
        const repositoryRoot = await fs.realpath(await GitHelper.getRoot(this.settings.repo))
        if (path.dirname(publishingDirectory) !== repositoryRoot || path.basename(publishingDirectory) !== 'notes') {
            throw new Error('发布目录必须是独立 Git 仓库根目录下的 notes 文件夹。')
        }
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            const vaultDirectory = await fs.realpath(this.app.vault.adapter.getBasePath())
            if (repositoryRoot === vaultDirectory || repositoryRoot.startsWith(vaultDirectory + path.sep)) {
                throw new Error('公开 Git 仓库不能放在 Obsidian 仓库内部。')
            }
        }
        if (await GitHelper.getCurrentBranch(this.settings.repo) !== this.settings.repoBranch) {
            await GitHelper.switchBranch(this.settings.repo, this.settings.repoBranch)
        }
        return true
    }

    async loadSettings() {
        const data = (await this.loadData()) as Partial<SelectivePublisherSettings> | null
        this.settings = { ...DEFAULT_SETTINGS, ...data }
        for (const key of ['selectedFiles', 'selectedFolders', 'excludedFiles'] as const) {
            if (!Array.isArray(this.settings[key])) this.settings[key] = []
        }
    }

    async saveSettings() {
        await this.saveData(this.settings)
        this.publishingService = new PublishingService(this.app, this.settings.repo)
    }
}
