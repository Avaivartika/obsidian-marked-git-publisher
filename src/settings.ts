import { Criterion, TextMatchMode, TagMatchMode, PathCriterion, OrCriterion, NotCriterion, TagCriterion, TitleCriterion } from './criteria/criteria'

export interface SelectivePublisherSettings {
    repo: string
    repoBranch: string
    criterion: Criterion
    commitMessage: string
    showPreviewBeforePublishing: boolean
    publishAttachments: boolean
    extraFilePatterns: string
}

// Default criterion: all notes except those with a path starting with an underscore, a "todo" tag, or an untitled or date-only title
export const DEFAULT_SETTINGS: SelectivePublisherSettings = {
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
