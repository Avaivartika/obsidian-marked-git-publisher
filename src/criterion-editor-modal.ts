import { App, Modal, Setting, ButtonComponent, DropdownComponent, TextComponent, TextAreaComponent, ExtraButtonComponent, AbstractTextComponent, setIcon } from 'obsidian'
import { CriterionType, TextMatchMode, TagMatchMode, FrontmatterMatchMode, Criterion, PatternCriterion, FrontmatterCriterion, ContentCriterion, TitleCriterion, PathCriterion, AndCriterion, OrCriterion, NotCriterion, TagCriterion, isValidGlobPattern, CRITERION_TYPE_NAMES } from './criterion'

// Validators return an error message, or null if the value is valid

type Validator = (value: string) => string | null

function validateRegex(pattern: string): string | null {
    try {
        new RegExp(pattern)
        return null
    } catch {
        return 'Invalid regex'
    }
}

// Validates line-separated .gitignore-like glob patterns
// Supports: * ** ? [chars] ! (negate) # (comment) leading / (anchor)
function validateGlobPatterns(value: string): string | null {
    const invalidLineNumbers = value.split('\n')
        .map((line, i) => isValidGlobPattern(line, true, true) ? -1 : i + 1)
        .filter(n => n !== -1)

    if (invalidLineNumbers.length === 0) return null
    return invalidLineNumbers.length === 1
        ? `Invalid glob pattern on line ${invalidLineNumbers[0]}`
        : `Invalid glob patterns on lines ${invalidLineNumbers.join(', ')}`
}

// Wires live validation to a text component, showing the error message in errorEl
function attachValidation(component: AbstractTextComponent<HTMLInputElement | HTMLTextAreaElement>, errorEl: HTMLElement, validate: Validator, setValue: (v: string) => void) {
    component.inputEl.addClass('sp-pattern-input')
    const check = (value: string) => {
        const error = validate(value)
        errorEl.setText(error ?? '')
        if (error !== null) component.inputEl.setAttribute('aria-invalid', 'true')
        else component.inputEl.removeAttribute('aria-invalid')
    }
    component.onChange((value) => {
        check(value)
        setValue(value)
    })
    check(component.getValue())
}

// Helper to add a textarea for glob patterns with live validation to a setting
export function addGlobField(setting: Setting, getValue: () => string, setValue: (v: string) => void) {
    // Show the error below the setting rather than inside it
    const errorEl = setting.settingEl.createDiv({ cls: 'sp-pattern-error' })
    setting.settingEl.after(errorEl)
    setting.addTextArea((textArea) => attachValidation(textArea.setValue(getValue()), errorEl, validateGlobPatterns, setValue))
}

// Compact inline controls for the criterion editor, labelled by placeholder and aria-label

function addDropdown<T extends string>(parent: HTMLElement, options: readonly T[], value: T, label: string, onChange: (v: T) => void) {
    const dropdown = new DropdownComponent(parent)
    for (const option of options)
        dropdown.addOption(option, option)
    dropdown.setValue(value).onChange((v) => onChange(v as T))
    dropdown.selectEl.setAttribute('aria-label', label)
}

function addTextField(component: AbstractTextComponent<HTMLInputElement | HTMLTextAreaElement>, value: string, label: string, setValue: (v: string) => void, validation?: { errorEl: HTMLElement, validate: Validator }) {
    component.setValue(value).setPlaceholder(label)
    component.inputEl.setAttribute('aria-label', label)
    if (validation)
        attachValidation(component, validation.errorEl, validation.validate, setValue)
    else
        component.onChange(setValue)
}

export class CriterionEditorModal extends Modal {
    rootCriterion: Criterion
    onSave: (updatedCriterion: Criterion) => void

    constructor(app: App, criterion: Criterion, onSave: (updatedCriterion: Criterion) => void) {
        super(app)
        // Clone the criterion to avoid modifying the original object directly
        this.rootCriterion = Criterion.deserialize(criterion.serialize())
        this.onSave = onSave
    }

    onOpen() {
        const { contentEl, modalEl } = this

        contentEl.empty()
        modalEl.addClass('sp-modal-fixed-footer')
        this.setTitle('Edit publishing criterion')

        this.renderCriterion(contentEl.createDiv(), this.rootCriterion, (c) => this.rootCriterion = c)

        const btnContainer = modalEl.createDiv('modal-button-container')

        new ButtonComponent(btnContainer)
            .setButtonText('Save')
            .setCta()
            .onClick(() => {
                this.onSave(this.rootCriterion)
                this.close()
            })

        new ButtonComponent(btnContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close()
            })
    }

    // replace swaps this criterion for a new one in its parent (or at the root)
    renderCriterion(container: HTMLElement, criterion: Criterion, replace: (c: Criterion) => void, onDelete?: () => void) {
        container.empty()

        const rerender = () => this.renderCriterion(container, criterion, replace, onDelete)

        // The type dropdown is followed by a body, so that continuation rows align with the first field
        const itemEl = container.createDiv({ cls: 'sp-criterion-item' })

        addDropdown(itemEl, CRITERION_TYPE_NAMES, criterion.getType(), 'Criterion type', (value) => {
            const newCriterion = this.createDefaultCriterionByType(value)
            replace(newCriterion)
            this.renderCriterion(container, newCriterion, replace, onDelete)
        })

        const bodyEl = itemEl.createDiv({ cls: 'sp-criterion-body' })
        // A single row holds the inline fields
        const row = bodyEl.createDiv({ cls: 'sp-criterion-row' })
        // Multi-line fields and validation errors go below the row
        const extraEl = bodyEl.createDiv({ cls: 'sp-criterion-row-extra' })
        const errorEl = bodyEl.createDiv({ cls: 'sp-pattern-error' })

        // Changing the match mode changes which fields are shown
        const addModeDropdown = <T extends string>(modes: readonly T[], value: T, setMode: (v: T) => void) =>
            addDropdown(row, modes, value, 'Match mode', (v) => {
                setMode(v)
                rerender()
            })

        // Render type-specific fields
        if (criterion instanceof FrontmatterCriterion) {
            addTextField(new TextComponent(row), criterion.key, 'Property', (v) => criterion.key = v)
            addModeDropdown(Object.values(FrontmatterMatchMode), criterion.matchMode, (v) => criterion.matchMode = v)
            if (criterion.matchMode !== FrontmatterMatchMode.Exists) {
                const validation = criterion.matchMode === FrontmatterMatchMode.Regex ? { errorEl, validate: validateRegex } : undefined
                addTextField(new TextComponent(row), criterion.value, 'Value', (v) => criterion.value = v, validation)
            }

        } else if (criterion instanceof TagCriterion) {
            addModeDropdown(Object.values(TagMatchMode), criterion.matchMode, (v) => criterion.matchMode = v)
            addTextField(new TextComponent(row), criterion.tag, 'Tag', (v) => criterion.tag = v)

        } else if (criterion instanceof PatternCriterion) {
            addModeDropdown(Object.values(TextMatchMode), criterion.matchMode, (v) => criterion.matchMode = v)
            const setPattern = (v: string) => criterion.pattern = v
            switch (criterion.matchMode) {
                case TextMatchMode.Regex:
                    addTextField(new TextComponent(row), criterion.pattern, 'Regular expression', setPattern, { errorEl, validate: validateRegex })
                    break
                case TextMatchMode.Glob:
                    addTextField(new TextAreaComponent(extraEl), criterion.pattern, 'Glob patterns, one per line', setPattern, { errorEl, validate: validateGlobPatterns })
                    break
                case TextMatchMode.Contains:
                default:
                    addTextField(new TextComponent(row), criterion.pattern, 'Text', setPattern)
                    break
            }

        } else if (criterion instanceof ContentCriterion) {
            addTextField(new TextComponent(row), criterion.regex, 'Regular expression', (v) => criterion.regex = v, { errorEl, validate: validateRegex })
        }

        if (onDelete) {
            new ExtraButtonComponent(row)
                .setIcon('cross')
                .setTooltip('Remove criterion')
                .onClick(onDelete)
                .extraSettingsEl.addClass('sp-criterion-remove')
        }

        // Render sub-criteria, indented below the row
        if (criterion instanceof AndCriterion || criterion instanceof OrCriterion) {
            const childrenEl = container.createDiv({ cls: 'sp-criterion-children' })
            criterion.criteria.forEach((sub, i) => {
                const subOnDelete = () => {
                    criterion.criteria.splice(i, 1)
                    rerender()
                }
                this.renderCriterion(childrenEl.createDiv(), sub, (c) => criterion.criteria[i] = c, subOnDelete)
            })

            const addButton = childrenEl.createEl('button', { cls: 'sp-criterion-add' })
            setIcon(addButton.createSpan(), 'plus')
            addButton.createSpan({ text: 'Add condition' })
            addButton.onClickEvent(() => {
                criterion.criteria.push(this.createDefaultCriterionByType('Frontmatter'))
                rerender()
            })

        } else if (criterion instanceof NotCriterion) {
            const childrenEl = container.createDiv({ cls: 'sp-criterion-children' })
            this.renderCriterion(childrenEl.createDiv(), criterion.criterion, (c) => criterion.criterion = c)
        }
    }

    createDefaultCriterionByType(type: CriterionType): Criterion {
        switch (type) {
            case 'Tag': return new TagCriterion('public')
            case 'Frontmatter': return new FrontmatterCriterion('public', 'true', FrontmatterMatchMode.Equals)
            case 'Title': return new TitleCriterion('^[^_].*', TextMatchMode.Regex)
            case 'Path': return new PathCriterion('^**/.*\n_*', TextMatchMode.Glob)
            case 'Content': return new ContentCriterion('^(?!.*#todo)(?!.*#private).*')
            case 'And': return new AndCriterion([this.createDefaultCriterionByType('Tag')])
            case 'Or': return new OrCriterion([this.createDefaultCriterionByType('Tag')])
            case 'Not': return new NotCriterion(new TagCriterion('private'))
            default: throw new Error(`Unknown criterion type: ${type as string}`)
        }
    }
}
