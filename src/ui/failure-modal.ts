import { App, Modal } from 'obsidian'

export class FailureModal extends Modal {
    error: Error | string
    repoPath: string

    constructor(app: App, error: Error | string, repoPath: string) {
        super(app)
        this.error = error
        this.repoPath = repoPath
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()

        contentEl.createEl('h2', { text: 'Publishing failed' })
        contentEl.createEl('p', { text: 'An error occurred while publishing:' })

        const errorMsg = this.error instanceof Error ? this.error.message : String(this.error)
        const pre = contentEl.createEl('pre', { cls: 'sp-error-log' })
        pre.setText(errorMsg)
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}
