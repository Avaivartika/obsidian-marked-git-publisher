export interface SelectivePublisherSettings {
    repo: string
    repoBranch: string
    selectedFiles: string[]
    selectedFolders: string[]
    excludedFiles: string[]
    commitMessage: string
    showPreviewBeforePublishing: boolean
    publishAttachments: boolean
    autoPublish: boolean
}

export const DEFAULT_SETTINGS: SelectivePublisherSettings = {
    repo: '/path/to/publish/repo',
    repoBranch: 'main',
    selectedFiles: [],
    selectedFolders: [],
    excludedFiles: [],
    commitMessage: 'Update published notes',
    showPreviewBeforePublishing: true,
    publishAttachments: true,
    autoPublish: true,
}
