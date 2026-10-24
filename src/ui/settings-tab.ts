import { App, PluginSettingTab, Setting, Notice, DropdownComponent, TextComponent } from 'obsidian'
import SelectivePublisherPlugin from '../main'
import { CriterionEditorModal, addGlobField } from './criterion-editor-modal'
import { GitHelper } from '../publishing/git-helper'
import { dialog } from '@electron/remote'

export class SelectivePublisherSettingTab extends PluginSettingTab {
    plugin: SelectivePublisherPlugin

    constructor(app: App, plugin: SelectivePublisherPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display(): void {
        const { containerEl } = this

        containerEl.empty()
        new Setting(containerEl).setName('Publishing repository').setHeading()

        let repoContentPathText: TextComponent
        new Setting(containerEl)
            .setName('Publishing directory')
            .setDesc('Path to the content directory in a local Git repository for publishing.')
            .addText((text) => {
                repoContentPathText = text
                text.setPlaceholder('Enter repository path')
                    .setValue(this.plugin.settings.repo)
                    .onChange(async (value) => {
                        this.plugin.settings.repo = value
                        await this.plugin.saveSettings()
                        await this.validateAndRefreshRepoBranches(repoBranchDropdown)
                    })
            })
            .addExtraButton((btn) => btn
                .setIcon('folder')
                .setTooltip('Select content directory in repository')
                .onClick(async () => {
                    try {
                        const result = await dialog.showOpenDialog({
                            properties: ['openDirectory'],
                            defaultPath: this.plugin.settings.repo
                        })

                        if (!result.canceled && result.filePaths.length > 0) {
                            const selectedPath = result.filePaths[0]!
                            this.plugin.settings.repo = selectedPath
                            repoContentPathText.setValue(selectedPath)
                            await this.plugin.saveSettings()
                            await this.validateAndRefreshRepoBranches(repoBranchDropdown)
                        }
                    } catch (error) {
                        console.error('Directory picker error:', error)
                        new Notice('Failed to open directory picker.')
                    }
                })
            )

        let repoBranchDropdown: DropdownComponent
        new Setting(containerEl)
            .setName('Branch')
            .setDesc('Branch to push the published notes to.')
            .addDropdown((dropdown) => {
                repoBranchDropdown = dropdown
                void this.refreshRepoBranchDropdown(dropdown)
                dropdown.onChange(async (value) => {
                    this.plugin.settings.repoBranch = value
                    await this.plugin.saveSettings()
                })
            })

        new Setting(containerEl)
            .setName('Commit message')
            .setDesc('Default commit message for publishing changes.')
            .addText((text) =>
                text.setPlaceholder('Enter commit message')
                    .setValue(this.plugin.settings.commitMessage)
                    .onChange(async (value) => {
                        this.plugin.settings.commitMessage = value
                        await this.plugin.saveSettings()
                    })
            )

        new Setting(containerEl).setName('Files to publish').setHeading()

        new Setting(containerEl)
            .setName('Show preview before publishing')
            .setDesc('Show the publishing preview modal before publishing.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showPreviewBeforePublishing)
                    .onChange(async (value) => {
                        this.plugin.settings.showPreviewBeforePublishing = value
                        await this.plugin.saveSettings()
                    })
            )

        new Setting(containerEl)
            .setName('Publishing criterion')
            .setDesc('The criterion for selecting Markdown notes to publish.')
            .addButton((btn) => btn
                .setButtonText('Edit criterion')
                .setCta()
                .onClick(() => {
                    new CriterionEditorModal(this.app, this.plugin.settings.criterion, (updatedCriterion) => {
                        this.plugin.settings.criterion = updatedCriterion
                        void this.plugin.saveSettings().then(() => this.display())
                    }).open()
                })
            )
            .addButton((btn) => btn
                .setButtonText('Preview publishable files')
                .onClick(() => { void this.plugin.previewPublishableFiles() })
            )
        // Representation of the current criterion
        containerEl.createEl('pre', {
            text: this.plugin.settings.criterion.getSummary(),
            cls: 'sp-criterion-summary',
        })

        new Setting(containerEl)
            .setName('Publish attachments')
            .setDesc('Publish attachments referenced in publishable notes.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.publishAttachments)
                    .onChange(async (value) => {
                        this.plugin.settings.publishAttachments = value
                        await this.plugin.saveSettings()
                    })
            )

        const extraPatternsSetting = new Setting(containerEl)
            .setName('Extra file patterns')
            .setDesc('Glob patterns (one per line) for additional vault files to publish, regardless of the publishing criterion. Supports !, #, and ** syntax.')
        addGlobField(extraPatternsSetting, () => this.plugin.settings.extraFilePatterns,
            (value) => {
                void (async () => {
                    this.plugin.settings.extraFilePatterns = value
                    await this.plugin.saveSettings()
                })()
            }
        )

        void this.validateAndRefreshRepoBranches(repoBranchDropdown!)
    }

    async validateAndRefreshRepoBranches(dropdown?: DropdownComponent) {
        const result = await GitHelper.validateRepo(this.plugin.settings.repo)
        if (!result.isValid) {
            new Notice(result.error || 'Invalid repository path')
        }
        if (dropdown) {
            await this.refreshRepoBranchDropdown(dropdown)
        }
    }

    async refreshRepoBranchDropdown(dropdown: DropdownComponent) {
        const branches = await GitHelper.getBranches(this.plugin.settings.repo)
            .catch(() => [] as string[])

        // Rebuilds the options from the current branches
        const selectEl = dropdown.selectEl
        selectEl.empty()

        if (branches.length === 0) {
            dropdown.addOption('', 'No branches found')
            dropdown.setDisabled(true)
            this.plugin.settings.repoBranch = ''
        } else {
            dropdown.setDisabled(false)
            branches.forEach(branch => {
                dropdown.addOption(branch, branch)
            })

            if (!branches.includes(this.plugin.settings.repoBranch)) {
                // Falls back to the first branch, and saves it, if the current one is not listed
                this.plugin.settings.repoBranch = branches[0]!
                await this.plugin.saveSettings()
            }
        }

        dropdown.setValue(this.plugin.settings.repoBranch)
    }


}
