export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
    kind: DiffLineKind
    /** Line number in the old file, absent for added lines */
    oldLineNum?: number
    /** Line number in the new file, absent for removed lines */
    newLineNum?: number
    text: string
}

export type FileDiff =
    | { kind: 'changed', hunks: DiffLine[][] }
    | { kind: 'binary' }
    | { kind: 'identical' }

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const LINE_KINDS: Record<string, DiffLineKind> = { ' ': 'context', '+': 'added', '-': 'removed' }

/** Parses the unified `git diff` output of a single file. */
export function parseDiff(output: string): FileDiff {
    const hunks: DiffLine[][] = []
    let hunk: DiffLine[] | undefined
    let oldLineNum = 0
    let newLineNum = 0

    for (const line of output.split('\n')) {
        const header = HUNK_HEADER_REGEX.exec(line)
        if (header) {
            hunk = []
            hunks.push(hunk)
            oldLineNum = Number(header[1])
            newLineNum = Number(header[2])
            continue
        }

        const kind = LINE_KINDS[line.charAt(0)]
        // Skip the file headers (diff --git, index, ---, +++) before the first hunk, notes such as
        // "\ No newline at end of file", and the trailing empty line
        if (!hunk || !kind) continue

        const diffLine: DiffLine = { kind, text: line.slice(1) }
        if (kind === 'context' || kind === 'removed') diffLine.oldLineNum = oldLineNum++
        if (kind === 'context' || kind === 'added') diffLine.newLineNum = newLineNum++
        hunk.push(diffLine)
    }

    if (hunks.length > 0) return { kind: 'changed', hunks }
    // Without hunks, git either reports "Binary files a and b differ" or prints nothing for identical files
    return { kind: /^Binary files/m.test(output) ? 'binary' : 'identical' }
}
