import { App, Modal, ButtonComponent, ExtraButtonComponent } from 'obsidian'
import { FileWithStatus, FileUpdateStatus } from '../publishing/publishing-service'
import { FileDiff } from '../publishing/diff-parser'
import { renderDiff } from './diff-view'

export type PublishAction = 'publish' | 'commit'

export class PublishPreviewModal extends Modal {
    constructor(app: App, private fileStatuses: FileWithStatus[], private hasUncommittedChanges: boolean,
        private onAction: (action: PublishAction) => Promise<void>, private getDiff: (path: string) => Promise<FileDiff>) {
        super(app)
    }

    onOpen() {
        const { contentEl, modalEl } = this
        this.setTitle('GitHub 公开同步预览')
        modalEl.addClass('sp-modal-fixed-footer')
        contentEl.empty()

        const sortedFiles = [...this.fileStatuses].sort((a, b) => a.path.localeCompare(b.path))
        const changed = sortedFiles.filter(f => f.status !== FileUpdateStatus.Unmodified)
        const unmodified = sortedFiles.filter(f => f.status === FileUpdateStatus.Unmodified)

        if (sortedFiles.length === 0 && !this.hasUncommittedChanges) {
            contentEl.createEl('p', { text: '当前没有已标记的文件，也没有待撤回的公开文件。' })
        } else {
            if (changed.length === 0 && !this.hasUncommittedChanges) {
                contentEl.createEl('p', { text: '公开文件已是最新状态。' })
            } else {
                this.renderFileList(contentEl, '待变更文件', changed)
            }
            this.renderFileList(contentEl, '未变更文件', unmodified, true)
        }

        const btnContainer = modalEl.createDiv('modal-button-container')

        if (changed.length > 0 || this.hasUncommittedChanges) {
            new ButtonComponent(btnContainer)
                .setButtonText('推送到 GitHub')
                .setCta()
                .onClick(async () => {
                    this.close()
                    await this.onAction('publish')
                })

            new ButtonComponent(btnContainer)
                .setButtonText('仅本地提交')
                .onClick(async () => {
                    this.close()
                    await this.onAction('commit')
                })
        }

        new ButtonComponent(btnContainer)
            .setButtonText('取消')
            .onClick(() => {
                this.close()
            })
    }

    private renderFileList(container: HTMLElement, title: string, files: FileWithStatus[], hideBadge = false) {
        if (files.length === 0) return

        container.createEl('h4', { text: `${title} (${files.length})` })
        const listEl = container.createEl('ul', { cls: 'sp-publish-preview-list' })

        for (const { path, status } of files) {
            const li = listEl.createEl('li', { cls: `is-${status}` })
            const pathEl = li.createSpan({ text: path, cls: 'sp-publish-path' })
            if (status === FileUpdateStatus.Modified) {
                pathEl.addClass('is-clickable')
                pathEl.setAttr('aria-label', '查看变更')
                pathEl.onClickEvent(() => this.toggleDiff(li, path))
            }
            if (status !== FileUpdateStatus.Deleted) {
                new ExtraButtonComponent(li)
                    .setIcon('file-symlink')
                    .setTooltip('打开文件')
                    .onClick(() => {
                        this.close()
                        void this.app.workspace.openLinkText(path, '', 'tab')
                    })
            }
            if (!hideBadge) {
                const translated = { new: '新增', modified: '修改', deleted: '删除', unmodified: '未变更' }
                li.createSpan({ text: translated[status], cls: 'sp-publish-badge' })
            }
        }
    }

    private async toggleDiff(li: HTMLElement, path: string) {
        // Keep a loaded diff around so collapsing and expanding it again doesn't rerun git
        const existing = li.querySelector<HTMLElement>('.sp-publish-diff')
        if (existing) {
            existing.hidden = !existing.hidden
            return
        }

        const diffEl = li.createDiv('sp-publish-diff')
        const messageEl = diffEl.createDiv({ cls: 'sp-diff-message', text: '正在读取变更…' })
        try {
            const diff = await this.getDiff(path)
            messageEl.remove()
            renderDiff(diffEl, diff)
        } catch (error) {
            messageEl.setText(`读取变更失败：${error instanceof Error ? error.message : String(error)}`)
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}
