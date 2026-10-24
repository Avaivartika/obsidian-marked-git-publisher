import picomatch from 'picomatch'

const GLOB_OPTIONS = { dot: true, contains: true }

/**
 * Information extracted from a single line of a glob pattern.
 */
interface GlobLineInfo {
    isNegated: boolean
    glob: string
}

/**
 * Parses a single line of a .gitignore-style glob pattern.
 * Handles trimming, comments (#), and negation (!).
 */
function parseGlobLine(line: string): GlobLineInfo {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
        return { isNegated: false, glob: '' }
    }
    const lineIsNegated = trimmed.startsWith('!')
    const glob = lineIsNegated ? trimmed.slice(1) : trimmed
    return { isNegated: lineIsNegated, glob }
}

/**
 * Returns true if the given line is a valid .gitignore-style glob pattern.
 */
export function isValidGlobPattern(line: string, { allowNegated = false, allowEmptyOrComment = false } = {}): boolean {
    const { isNegated, glob } = parseGlobLine(line)
    if (glob.length === 0) return allowEmptyOrComment
    try {
        picomatch(glob, GLOB_OPTIONS)
        return allowNegated || !isNegated
    } catch {
        return false
    }
}

/**
 * Tests a value against line-separated .gitignore-style glob patterns.
 * Supports # comments, ! negation, and last-match-wins semantics.
 */
export function matchesGlobPatterns(multiLinePattern: string, input: string): boolean {
    let inputIsMatched = false
    for (const rawLine of multiLinePattern.split('\n')) {
        const { isNegated, glob } = parseGlobLine(rawLine)
        if (glob.length === 0) continue

        try {
            const isMatch = picomatch(glob, GLOB_OPTIONS)
            if (isMatch(input)) {
                inputIsMatched = !isNegated
            }
        } catch {
            console.error(`Invalid glob pattern: ${glob}`)
        }
    }
    return inputIsMatched
}
