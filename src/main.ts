import { Notice, Plugin, TFile } from 'obsidian'
import { PublishPreviewModal, PublishAction } from './publish-preview-modal'
import { FailureModal } from './failure-modal'
import { Criterion, TextMatchMode, TagMatchMode, PathCriterion, OrCriterion, NotCriterion, TagCriterion, TitleCriterion, matchesGlobPatterns } from './criterion'
import { SelectivePublisherSettingTab } from './settings-tab'
import { GitHelper } from './git-service'
import { PublishingService } from './publishing-service'

interface SelectivePublisherSettings {
    repo: string
    repoBranch: string
    criterion: Criterion
    commitMessage: string
    showPreviewBeforePublishing: boolean
    publishAttachments: boolean
    extraFilePatterns: string
}

async function filterAsync<T>(arr: T[], cond: (el: T) => Promise<boolean>): Promise<T[]> {
    const results = await Promise.all(arr.map(cond))
    return arr.filter((_, index) => results[index])
}

// Default criterion: notes with frontmatter "publish: true"
const DEFAULT_SETTINGS: SelectivePublisherSettings = {
    repo: '/path/to/publish/repo',
    repoBranch: 'main',
    criterion: new NotCriterion(new OrCriterion([
        new PathCriterion('**/_*\n_*', TextMatchMode.Glob),
        new TagCriterion('todo', TagMatchMode.StartsWith),
        new TitleCriterion('Untitled*', TextMatchMode.Glob),
        new TitleCriterion('^\\d+-\\d+-\\d+$', TextMatchMode.Regex),
    ])),
    commitMessage: 'Update published notes',
    showPreviewBeforePublishing: true,
    publishAttachments: true,
    extraFilePatterns: '*.sty\n*.bib',
}

export default class SelectivePublisherPlugin extends Plugin {
    settings!: SelectivePublisherSettings
    publishingService!: PublishingService

    async onload() {
        await this.loadSettings()
        this.publishingService = new PublishingService(this.app, this.settings.repo)

        // Add publish command
        this.addCommand({
            id: 'publish-notes',
            name: 'Publish notes',
            callback: () => this.publishNotes(),
        })

        // Add preview command
        this.addCommand({
            id: 'preview-publishable',
            name: 'Preview publishable files',
            callback: () => this.previewPublishableFiles(),
        })

        // Add a ribbon icon
        this.addRibbonIcon('paper-plane', 'Publish notes', () => { void this.publishNotes() })

        this.addSettingTab(new SelectivePublisherSettingTab(this.app, this))
    }

    async getPublishableFiles(): Promise<TFile[]> {
        const markdownFiles = this.app.vault.getMarkdownFiles()
        const publishableNotes = await this.filterPublishableFiles(markdownFiles)

        const publishableSet = new Set<TFile>()
        for (const file of publishableNotes) {
            publishableSet.add(file)
        }

        if (this.settings.publishAttachments) {
            for (const file of publishableNotes) {
                const referencedAttachments = this.getReferencedAttachments(file)
                referencedAttachments.forEach(attachment => publishableSet.add(attachment))
            }
        }

        if (this.settings.extraFilePatterns.trim()) {
            const allFiles = this.app.vault.getFiles().filter(f => matchesGlobPatterns(this.settings.extraFilePatterns, f.path.replace(/\\/g, '/')))
            for (const file of allFiles) {
                publishableSet.add(file)
            }
        }

        return Array.from(publishableSet)
    }

    private getReferencedAttachments(file: TFile): TFile[] {
        const metadata = this.app.metadataCache.getFileCache(file)
        if (!metadata) return []

        const attachments: TFile[] = []
        const links = [...(metadata.links ?? []), ...(metadata.embeds ?? [])]

        for (const link of links) {
            const linkPath = link.link.split('#')[0]!
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path)
            if (linkedFile instanceof TFile && linkedFile.extension !== 'md') {
                attachments.push(linkedFile)
            }
        }

        return attachments
    }

    async previewPublishableFiles() {
        try {
            const publishableFiles = await this.getPublishableFiles()
            const fileStatuses = await this.publishingService.getPublishingStatuses(publishableFiles)
            const hasUncommittedChanges = await GitHelper.hasUncommittedChanges(this.settings.repo)

            if (fileStatuses.length === 0 && !hasUncommittedChanges) {
                new Notice('No files to publish or unpublish.')
                return
            }

            const modal = new PublishPreviewModal(this.app, fileStatuses, hasUncommittedChanges,
                (action: PublishAction) => this.publishNotes(action === 'commit', true, publishableFiles),
                (path: string) => this.publishingService.getFileDiff(path))
            modal.open()
        } catch (error) {
            console.error('Preview failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    async publishNotes(onlyCommit = false, skipPreview = false, cachedPublishableFiles?: TFile[]) {
        try {
            if (!skipPreview && this.settings.showPreviewBeforePublishing) {
                await this.previewPublishableFiles()
                return
            }

            if (!this.settings.repoBranch) {
                new Notice('No publishing branch selected. Please check the settings.')
                return
            }

            const operationStr = onlyCommit ? 'commit' : 'publish'
            new Notice(`Starting ${operationStr} operation...`)

            if (!onlyCommit) {
                // Sync with remote repository if not onlyCommit
                try {
                    await GitHelper.pull(this.settings.repo, this.settings.repoBranch)
                } catch (syncError) {
                    // Merge conflict occurred
                    throw new Error(`Cannot sync with remote: ${(syncError as Error).message}`)
                }
            }

            const publishableFiles = cachedPublishableFiles ?? await this.getPublishableFiles()
            await this.publishingService.updateFilesInRepo(publishableFiles)

            // Commit and optionally push changes
            try {
                await GitHelper.add(this.settings.repo)
                await GitHelper.commit(this.settings.repo, this.settings.commitMessage)
                if (!onlyCommit) {
                    await GitHelper.push(this.settings.repo, this.settings.repoBranch)
                }
                const noteCount = publishableFiles.filter(f => f.extension === 'md').length
                new Notice(`Successfully ${operationStr}ed ${noteCount} notes.`)
            } catch (error) {
                console.error('Git operation failed:', error)
                throw new Error(`Git operation failed: ${(error as Error).message}`)
            }
        } catch (error) {
            console.error('Publishing failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    async filterPublishableFiles(files: TFile[]): Promise<TFile[]> {
        return filterAsync(files, file => this.isFilePublishable(file))
    }

    async isFilePublishable(file: TFile): Promise<boolean> {
        try {
            const metadata = this.app.metadataCache.getFileCache(file)
            if (!metadata) {
                return false
            }
            const content = await this.app.vault.read(file)
            return this.settings.criterion.evaluate(file, content, metadata)
        } catch (error) {
            console.error(`Error evaluating publishability for ${file.path}:`, error)
            return false
        }
    }

    onunload() {
        // Clean up any event listeners or resources here
    }

    async loadSettings() {
        type SavedData = Partial<Omit<SelectivePublisherSettings, 'criterion'> & { criterion: import('./criterion').SerializedCriterion }>
        const data = (await this.loadData()) as SavedData | null
        this.settings = Object.assign({}, DEFAULT_SETTINGS)

        if (data) {
            if (data.criterion) this.settings.criterion = Criterion.deserialize(data.criterion)
            if (data.repo) this.settings.repo = data.repo
            if (data.repoBranch) this.settings.repoBranch = data.repoBranch
            if (data.commitMessage) this.settings.commitMessage = data.commitMessage
            if (data.showPreviewBeforePublishing !== undefined) {
                this.settings.showPreviewBeforePublishing = data.showPreviewBeforePublishing
            }
            if (data.publishAttachments !== undefined) {
                this.settings.publishAttachments = data.publishAttachments
            }
            if (data.extraFilePatterns !== undefined) {
                this.settings.extraFilePatterns = data.extraFilePatterns
            }
        }
    }

    async saveSettings() {
        const data = {
            ...this.settings,
            criterion: this.settings.criterion.serialize(),
        }
        await this.saveData(data)
        // Update service if repo path changed
        this.publishingService = new PublishingService(this.app, this.settings.repo)
    }
}
