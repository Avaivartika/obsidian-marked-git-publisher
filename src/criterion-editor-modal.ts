import { App, Modal, Menu, Setting, ButtonComponent, DropdownComponent, TextComponent, TextAreaComponent, ExtraButtonComponent, AbstractTextComponent, setIcon } from 'obsidian'
import { LeafCriterionType, TextMatchMode, TagMatchMode, FrontmatterMatchMode, Criterion, PatternCriterion, FrontmatterCriterion, ContentCriterion, TitleCriterion, PathCriterion, AndCriterion, OrCriterion, NotCriterion, TagCriterion, isValidGlobPattern, LEAF_CRITERION_TYPES, GROUP_CRITERION_TYPES, isGroupType, getChildren, wrapCriterion, convertGroup } from './criterion'

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

// The place a criterion occupies: the root, the operand of a Not, or an entry of an And/Or
interface Slot {
    // Stores a replacement criterion in the parent
    set: (c: Criterion) => void
    // Only for And/Or entries: replaces the criterion with zero or several and re-renders the parent
    splice?: (criteria: Criterion[]) => void
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

        this.renderCriterion(contentEl.createDiv(), this.rootCriterion, { set: (c) => this.rootCriterion = c })

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

    renderCriterion(container: HTMLElement, criterion: Criterion, slot: Slot) {
        container.empty()

        const rerender = () => this.renderCriterion(container, criterion, slot)
        const replace = (c: Criterion) => {
            slot.set(c)
            this.renderCriterion(container, c, slot)
        }

        // The type dropdown is followed by a body, so that continuation rows align with the first field
        const itemEl = container.createDiv({ cls: 'sp-criterion-item' })

        // The type can only change within leaves or within groups, so no sub-criteria are lost
        // Moving between the two is done by wrapping and unwrapping
        const onTypeChange = (c: Criterion) => {
            replace(c)
            container.querySelector('select')?.focus()
        }
        const currentType = criterion.getType()
        if (isGroupType(currentType))
            addDropdown(itemEl, GROUP_CRITERION_TYPES, currentType, 'Criterion type',
                (type) => onTypeChange(convertGroup(criterion, type)))
        else
            addDropdown(itemEl, LEAF_CRITERION_TYPES, currentType, 'Criterion type',
                (type) => onTypeChange(this.createDefaultCriterionByType(type)))

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

        const createMenu = () => this.createActionsMenu(criterion, slot, replace)
        const actionsEl = row.createDiv({ cls: 'sp-criterion-actions' })
        const menuButton = new ExtraButtonComponent(actionsEl)
            .setIcon('more-vertical')
            .setTooltip('More actions')
        menuButton.onClick(() => {
            const rect = menuButton.extraSettingsEl.getBoundingClientRect()
            createMenu().showAtPosition({ x: rect.left, y: rect.bottom })
        })
        const splice = slot.splice
        if (splice) {
            new ExtraButtonComponent(actionsEl)
                .setIcon('cross')
                .setTooltip('Remove criterion')
                .onClick(() => splice([]))
        }

        // Right-click opens the same menu, except in text fields, which keep their native menu
        itemEl.addEventListener('contextmenu', (evt) => {
            if ((evt.target as HTMLElement).closest('input, textarea')) return
            evt.preventDefault()
            createMenu().showAtMouseEvent(evt)
        })

        // Render sub-criteria, indented below the row
        if (criterion instanceof AndCriterion || criterion instanceof OrCriterion) {
            const childrenEl = container.createDiv({ cls: 'sp-criterion-children' })
            criterion.criteria.forEach((sub, i) => {
                this.renderCriterion(childrenEl.createDiv(), sub, {
                    set: (c) => criterion.criteria[i] = c,
                    splice: (cs) => {
                        criterion.criteria.splice(i, 1, ...cs)
                        rerender()
                    },
                })
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
            this.renderCriterion(childrenEl.createDiv(), criterion.criterion, { set: (c) => criterion.criterion = c })
        }
    }

    // Menu for restructuring the tree without losing sub-criteria
    createActionsMenu(criterion: Criterion, slot: Slot, replace: (c: Criterion) => void): Menu {
        const menu = new Menu()

        for (const type of GROUP_CRITERION_TYPES) {
            menu.addItem((item) => item
                .setTitle(`Wrap in ${type}`)
                .setIcon('group')
                .onClick(() => replace(wrapCriterion(criterion, type))))
        }

        // A single child takes the group's place, while other counts need a slot that accepts several
        const children = getChildren(criterion)
        const splice = slot.splice
        const onlyChild = children?.length === 1 ? children[0] : undefined
        let unwrap: (() => void) | undefined
        if (onlyChild) unwrap = () => replace(onlyChild)
        else if (children && splice) unwrap = () => splice(children)
        if (unwrap) {
            menu.addSeparator()
            menu.addItem((item) => item
                .setTitle('Unwrap')
                .setIcon('ungroup')
                .onClick(unwrap))
        }

        return menu
    }

    createDefaultCriterionByType(type: LeafCriterionType): Criterion {
        switch (type) {
            case 'Tag': return new TagCriterion('public')
            case 'Frontmatter': return new FrontmatterCriterion('public', 'true', FrontmatterMatchMode.Equals)
            case 'Title': return new TitleCriterion('^[^_].*', TextMatchMode.Regex)
            case 'Path': return new PathCriterion('^**/.*\n_*', TextMatchMode.Glob)
            case 'Content': return new ContentCriterion('^(?!.*#todo)(?!.*#private).*')
        }
    }
}
