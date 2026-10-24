import { DiffLine, DiffLineKind, FileDiff } from '../publishing/diff-parser'

const SIGNS: Partial<Record<DiffLineKind, string>> = { added: '+', removed: '−' }
// Words, whitespace runs, and single punctuation characters
const TOKEN_REGEX = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu
// Skip in-line emphasis for very long line pairs to keep the quadratic LCS cheap
const MAX_LCS_CELLS = 250000

/** Renders a diff as table rows with old/new line numbers, similar to VS Code's inline diff. */
export function renderDiff(container: HTMLElement, diff: FileDiff) {
    if (diff.kind !== 'changed') {
        const message = diff.kind === 'binary' ? 'Binary file changed.' : 'No content changes.'
        container.createDiv({ cls: 'sp-diff-message', text: message })
        return
    }

    const table = container.createEl('table')
    for (const hunk of diff.hunks) {
        table.createEl('tr', { cls: 'is-hunk' })
            .createEl('td', { text: '⋯', attr: { colspan: 4 } })
        renderHunk(table, hunk)
    }
}

function renderHunk(table: HTMLTableElement, lines: DiffLine[]) {
    // Text cells of the current block of removed lines and the added lines that replace them
    let removed: HTMLElement[] = []
    let added: HTMLElement[] = []
    const flushBlock = () => {
        removed.forEach((oldEl, i) => {
            const newEl = added[i]
            if (newEl) emphasizeChanges(oldEl, newEl)
        })
        removed = []
        added = []
    }

    for (const { kind, oldLineNum, newLineNum, text } of lines) {
        // A context line, or a removal following additions, ends the current block
        if (kind === 'context' || (kind === 'removed' && added.length > 0)) flushBlock()

        const row = table.createEl('tr', { cls: `is-${kind}` })
        row.createEl('td', { cls: 'sp-diff-num', text: oldLineNum?.toString() ?? '' })
        row.createEl('td', { cls: 'sp-diff-num', text: newLineNum?.toString() ?? '' })
        row.createEl('td', { cls: 'sp-diff-sign', text: SIGNS[kind] ?? '' })
        const textEl = row.createEl('td', { cls: 'sp-diff-text', text })
        if (kind === 'added') added.push(textEl)
        else if (kind === 'removed') removed.push(textEl)
    }
    flushBlock()
}

/** Highlights the words that differ between a removed line and the added line replacing it. */
function emphasizeChanges(oldEl: HTMLElement, newEl: HTMLElement) {
    const oldTokens = oldEl.getText().match(TOKEN_REGEX) ?? []
    const newTokens = newEl.getText().match(TOKEN_REGEX) ?? []
    const changes = diffTokens(oldTokens, newTokens)
    if (!changes) return

    const [oldChanged, newChanged] = changes
    // Lines sharing nothing but whitespace are rewrites, where emphasis would only add noise
    if (!oldTokens.some((token, i) => !oldChanged[i] && token.trim())) return

    renderTokens(oldEl, oldTokens, oldChanged)
    renderTokens(newEl, newTokens, newChanged)
}

/** Marks the tokens of `a` and `b` that are not part of their longest common subsequence, or returns null if too costly. */
function diffTokens(a: string[], b: string[]): [boolean[], boolean[]] | null {
    // Only the tokens between the common prefix and suffix need the LCS
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    let aEnd = a.length
    let bEnd = b.length
    while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
        aEnd--
        bEnd--
    }
    const aMid = a.slice(start, aEnd)
    const bMid = b.slice(start, bEnd)
    if (aMid.length * bMid.length > MAX_LCS_CELLS) return null

    // lcs[i * width + j] is the LCS length of aMid[i..] and bMid[j..]
    const width = bMid.length + 1
    const lcs = new Uint32Array((aMid.length + 1) * width)
    const at = (i: number, j: number) => lcs[i * width + j] ?? 0
    for (let i = aMid.length - 1; i >= 0; i--) {
        for (let j = bMid.length - 1; j >= 0; j--) {
            lcs[i * width + j] = aMid[i] === bMid[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
        }
    }

    const aChanged = a.map((_, k) => k >= start && k < aEnd)
    const bChanged = b.map((_, k) => k >= start && k < bEnd)
    let i = 0
    let j = 0
    while (i < aMid.length && j < bMid.length) {
        if (aMid[i] === bMid[j]) {
            aChanged[start + i++] = false
            bChanged[start + j++] = false
        } else if (at(i + 1, j) >= at(i, j + 1)) {
            i++
        } else {
            j++
        }
    }
    return [aChanged, bChanged]
}

function renderTokens(el: HTMLElement, tokens: string[], changed: boolean[]) {
    el.empty()
    let emphasisEl: HTMLElement | null = null
    tokens.forEach((token, i) => {
        if (!changed[i]) {
            el.appendText(token)
            emphasisEl = null
        } else if (emphasisEl) {
            emphasisEl.appendText(token)
        } else {
            emphasisEl = el.createSpan({ cls: 'sp-diff-emphasis', text: token })
        }
    })
}
