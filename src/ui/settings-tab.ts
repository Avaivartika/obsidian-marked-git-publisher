import { App, PluginSettingTab, Setting, Notice, DropdownComponent, TextComponent } from 'obsidian'
import SelectivePublisherPlugin from '../main'
import { GitHelper } from '../publishing/git-helper'
import { dialog } from '@electron/remote'

export class SelectivePublisherSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: SelectivePublisherPlugin) { super(app, plugin) }

    display(): void {
        const { containerEl } = this
        containerEl.empty()
        new Setting(containerEl).setName('GitHub 公开同步').setHeading()
        containerEl.createEl('p', { text: '在文件列表中右键笔记或文件夹，选择“标记用于 GitHub 公开同步”。发布前会显示全部新增、修改和删除的文件。' })
        let repoPathInput: TextComponent
        let branchDropdown: DropdownComponent
        new Setting(containerEl)
            .setName('发布目录')
            .setDesc('独立 Git 仓库中的 notes 目录。这个目录里的其他文件会在发布时清理。')
            .addText(text => {
                repoPathInput = text
                text.setPlaceholder('/path/to/repo/notes').setValue(this.plugin.settings.repo).onChange(async value => {
                    this.plugin.settings.repo = value.trim()
                    await this.plugin.saveSettings()
                    await this.refreshBranches(branchDropdown)
                })
            })
            .addExtraButton(button => button.setIcon('folder').setTooltip('选择目录').onClick(async () => {
                const result = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: this.plugin.settings.repo })
                if (!result.canceled && result.filePaths[0]) {
                    this.plugin.settings.repo = result.filePaths[0]
                    repoPathInput.setValue(result.filePaths[0])
                    await this.plugin.saveSettings()
                    await this.refreshBranches(branchDropdown)
                }
            }))
        new Setting(containerEl).setName('分支').setDesc('公开仓库的目标分支。').addDropdown(dropdown => {
            branchDropdown = dropdown
            void this.refreshBranches(dropdown)
            dropdown.onChange(async value => {
                this.plugin.settings.repoBranch = value
                await this.plugin.saveSettings()
            })
        })
        new Setting(containerEl).setName('提交说明').addText(text => text
            .setValue(this.plugin.settings.commitMessage)
            .onChange(async value => {
                this.plugin.settings.commitMessage = value.trim() || 'Update published notes'
                await this.plugin.saveSettings()
            }))
        new Setting(containerEl).setName('发布前预览').setDesc('显示变更清单，确认后再推送。').addToggle(toggle => toggle
            .setValue(this.plugin.settings.showPreviewBeforePublishing)
            .onChange(async value => {
                this.plugin.settings.showPreviewBeforePublishing = value
                await this.plugin.saveSettings()
            }))
        new Setting(containerEl).setName('自动同步').setDesc('关闭时手动预览并发布；开启后，已标记内容修改约 30 秒后自动推送，自动推送不会弹出预览。').addToggle(toggle => toggle
            .setValue(this.plugin.settings.autoPublish)
            .onChange(async value => {
                this.plugin.settings.autoPublish = value
                await this.plugin.saveSettings()
                if (value) this.plugin.scheduleAutoPublish()
            }))
        new Setting(containerEl).setName('附带引用的附件').setDesc('把已标记笔记中引用的图片等附件一并发布。').addToggle(toggle => toggle
            .setValue(this.plugin.settings.publishAttachments)
            .onChange(async value => {
                this.plugin.settings.publishAttachments = value
                await this.plugin.saveSettings()
            }))
        new Setting(containerEl).setName('当前标记').setHeading()
        this.renderSelections('文件夹', this.plugin.settings.selectedFolders, async path => {
            this.plugin.settings.selectedFolders = this.plugin.settings.selectedFolders.filter(item => item !== path)
            await this.plugin.saveSettings()
            this.display()
        })
        this.renderSelections('笔记', this.plugin.settings.selectedFiles, async path => {
            this.plugin.settings.selectedFiles = this.plugin.settings.selectedFiles.filter(item => item !== path)
            await this.plugin.saveSettings()
            this.display()
        })
        this.renderSelections('文件夹内排除的笔记', this.plugin.settings.excludedFiles, async path => {
            this.plugin.settings.excludedFiles = this.plugin.settings.excludedFiles.filter(item => item !== path)
            await this.plugin.saveSettings()
            this.display()
        })
        new Setting(containerEl).setName('预览公开文件').addButton(button => button
            .setButtonText('预览').onClick(() => { void this.plugin.previewPublishableFiles() }))
    }

    private renderSelections(label: string, paths: string[], remove: (path: string) => Promise<void>) {
        if (paths.length === 0) {
            this.containerEl.createEl('p', { text: `${label}：无` })
            return
        }
        for (const path of paths) {
            new Setting(this.containerEl).setName(path).setDesc(label).addExtraButton(button => button
                .setIcon('x').setTooltip('移除标记').onClick(() => { void remove(path) }))
        }
    }

    private async refreshBranches(dropdown?: DropdownComponent) {
        if (!dropdown) return
        const validation = await GitHelper.validateRepo(this.plugin.settings.repo)
        const branches = validation.isValid ? await GitHelper.getBranches(this.plugin.settings.repo).catch(() => []) : []
        dropdown.selectEl.empty()
        if (branches.length === 0) {
            dropdown.addOption('', '未找到分支')
            dropdown.setDisabled(true)
            if (!validation.isValid && this.plugin.settings.repo !== '/path/to/publish/repo') new Notice(validation.error ?? 'Git 仓库无效')
            return
        }
        dropdown.setDisabled(false)
        for (const branch of branches) dropdown.addOption(branch, branch)
        if (!branches.includes(this.plugin.settings.repoBranch)) {
            this.plugin.settings.repoBranch = branches[0]!
            await this.plugin.saveSettings()
        }
        dropdown.setValue(this.plugin.settings.repoBranch)
    }
}
