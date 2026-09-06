import { TFile, CachedMetadata } from 'obsidian'
import picomatch from 'picomatch'

// Serialization

// Type derived from class names (e.g., 'Tag' from TagCriterion)
export const CRITERION_TYPE_NAMES = ['Tag', 'Frontmatter', 'Title', 'Path', 'Content', 'And', 'Or', 'Not'] as const
export type CriterionType = typeof CRITERION_TYPE_NAMES[number]

export enum TextMatchMode {
    Contains = 'contains',
    Regex = 'matches regex',
    Glob = 'matches glob',
}

export enum TagMatchMode {
    Equals = 'equals',
    StartsWith = 'starts with',
    Includes = 'includes',
}

export enum FrontmatterMatchMode {
    Exists = 'exists',
    Equals = 'equals',
    Contains = 'contains',
    Regex = 'matches regex',
}

export interface SerializedCriterion {
    type: CriterionType
    [key: string]: unknown
}

const registry: Map<CriterionType, typeof Criterion> = new Map()

// Type for criterion class constructors that can be registered
interface CriterionClass {
    new(...args: never[]): Criterion
    deserialize(data: SerializedCriterion): Criterion
}

// Decorator for registering criterion classes
// Assumes that the class name ends with 'Criterion'
function RegisterCriterion<T extends CriterionClass>(constructor: T) {
    const type = constructor.name.replace('Criterion', '') as CriterionType
    registry.set(type, constructor as unknown as typeof Criterion)
}

// Utilities

function stringifyValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    return JSON.stringify(value)
}

function safeRegexTest(pattern: string, input: string, flags = 'i'): boolean {
    try {
        return new RegExp(pattern, flags).test(input)
    } catch {
        console.error(`Invalid regex pattern: ${pattern}`)
        return false
    }
}

const GLOB_OPTIONS = { dot: true, contains: true }

/**
 * Information extracted from a single line of a glob pattern.
 */
interface GlobLineInfo {
    negated: boolean
    glob: string
}

/**
 * Parses a single line of a .gitignore-style glob pattern.
 * Handles trimming, comments (#), and negation (!).
 */
function parseGlobLine(line: string): GlobLineInfo {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
        return { negated: false, glob: '' }
    }
    const negated = trimmed.startsWith('!')
    const glob = negated ? trimmed.slice(1) : trimmed
    return { negated, glob }
}

/**
 * Returns true if the given line is a valid .gitignore-style glob pattern.
 */
export function isValidGlobPattern(line: string, allowNegated: boolean = false, allowEmptyOrComment: boolean = false): boolean {
    const { negated, glob } = parseGlobLine(line)
    if (glob.length === 0) return allowEmptyOrComment
    try {
        picomatch(glob, GLOB_OPTIONS)
        return allowNegated || !negated
    } catch {
        return false
    }
}

/**
 * Test a value against line-separated .gitignore-style glob patterns.
 * Supports # comments, ! negation, and last-match-wins semantics.
 */
export function matchesGlobPatterns(multiLinePattern: string, input: string): boolean {
    let matched = false
    for (const rawLine of multiLinePattern.split('\n')) {
        const { negated, glob } = parseGlobLine(rawLine)
        if (glob.length === 0) continue

        try {
            const isMatch = picomatch(glob, GLOB_OPTIONS)
            if (isMatch(input)) {
                matched = !negated
            }
        } catch {
            console.error(`Invalid glob pattern: ${glob}`)
        }
    }
    return matched
}

export abstract class Criterion {
    static deserialize(data: SerializedCriterion): Criterion {
        const criterionClass = registry.get(data.type)
        if (!criterionClass) {
            throw new Error(`Unknown criterion type: ${data.type}`)
        }
        return criterionClass.deserialize(data)
    }

    abstract serialize(): SerializedCriterion
    abstract evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean
    abstract getSummary(): string

    getType(): CriterionType {
        return this.constructor.name.replace('Criterion', '') as CriterionType
    }
}

@RegisterCriterion
export class FrontmatterCriterion extends Criterion {
    constructor(
        public key: string,
        public value: string,
        public matchMode: FrontmatterMatchMode = FrontmatterMatchMode.Equals
    ) {
        super()
    }

    evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean {
        const frontmatterValue = metadata?.frontmatter?.[this.key] as unknown

        if (this.matchMode === FrontmatterMatchMode.Exists) {
            return frontmatterValue !== undefined
        }

        if (frontmatterValue === undefined) return false

        const stringVal = stringifyValue(frontmatterValue)
        switch (this.matchMode) {
            case FrontmatterMatchMode.Equals:
                return stringVal.toLowerCase() === this.value.toLowerCase()
            case FrontmatterMatchMode.Contains:
                return stringVal.toLowerCase().includes(this.value.toLowerCase())
            case FrontmatterMatchMode.Regex:
                return safeRegexTest(this.value, stringVal)
            default:
                return false
        }
    }

    getSummary(): string {
        if (this.matchMode === FrontmatterMatchMode.Exists) {
            return `Frontmatter: ${this.key} exists`
        }
        return `Frontmatter: ${this.key} ${this.matchMode} ${this.value}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), key: this.key, value: this.value, matchMode: this.matchMode }
    }

    static deserialize(data: SerializedCriterion): FrontmatterCriterion {
        return new FrontmatterCriterion(
            data.key as string,
            data.value as string,
            data.matchMode as FrontmatterMatchMode
        )
    }
}

@RegisterCriterion
export class ContentCriterion extends Criterion {
    constructor(public regex: string) {
        super()
    }

    evaluate(_file: TFile, content: string, _metadata: CachedMetadata): boolean {
        return safeRegexTest(this.regex, content)
    }

    getSummary(): string {
        return `Content matches: ${this.regex}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), regex: this.regex }
    }

    static deserialize(data: SerializedCriterion): ContentCriterion {
        return new ContentCriterion(data.regex as string)
    }
}


// Superclass for pattern-based criteria with configurable match mode
export abstract class PatternCriterion extends Criterion {
    constructor(public pattern: string, public matchMode: TextMatchMode) {
        super()
    }

    // Abstract: must provide the value to match against
    protected abstract getTargetValue(file: TFile): string

    evaluate(file: TFile, _content: string, _metadata: CachedMetadata): boolean {
        const value = this.getTargetValue(file)
        switch (this.matchMode) {
            case TextMatchMode.Regex:
                return safeRegexTest(this.pattern, value)
            case TextMatchMode.Glob:
                return matchesGlobPatterns(this.pattern, value)
            case TextMatchMode.Contains:
            default:
                return value.toLowerCase().includes(this.pattern.toLowerCase())
        }
    }

    getSummary(): string {
        return `${this.getType()} ${this.matchMode}: ${this.pattern}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), pattern: this.pattern, matchMode: this.matchMode }
    }
}

@RegisterCriterion
export class TitleCriterion extends PatternCriterion {
    constructor(public pattern: string = '', public matchMode: TextMatchMode) {
        super(pattern, matchMode)
    }

    protected getTargetValue(file: TFile): string {
        return file.basename
    }

    static deserialize(data: SerializedCriterion): TitleCriterion {
        return new TitleCriterion(data.pattern as string, data.matchMode as TextMatchMode)
    }
}

@RegisterCriterion
export class PathCriterion extends PatternCriterion {
    constructor(public pattern: string, public matchMode: TextMatchMode) {
        super(pattern, matchMode)
    }

    protected getTargetValue(file: TFile): string {
        // Normalize path separators for consistency
        return file.path.replace(/\\/g, '/')
    }

    static deserialize(data: SerializedCriterion): PathCriterion {
        return new PathCriterion(data.pattern as string, data.matchMode as TextMatchMode)
    }
}

function indentText(text: string, spaces: number): string {
    return text.replace(/^/gm, ' '.repeat(spaces))
}

@RegisterCriterion
export class AndCriterion extends Criterion {
    constructor(public criteria: Criterion[]) {
        super()
    }

    evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean {
        for (const criterion of this.criteria) {
            if (!criterion.evaluate(file, content, metadata)) {
                return false
            }
        }
        return true
    }

    getSummary(): string {
        const indentedChildren = this.criteria.map(c => indentText(c.getSummary(), 2)).join('\n')
        return `AND:\n${indentedChildren}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), criteria: this.criteria.map(c => c.serialize()) }
    }

    static deserialize(data: SerializedCriterion): AndCriterion {
        return new AndCriterion((data.criteria as SerializedCriterion[]).map(c => Criterion.deserialize(c)))
    }
}

@RegisterCriterion
export class OrCriterion extends Criterion {
    constructor(public criteria: Criterion[]) {
        super()
    }

    evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean {
        for (const criterion of this.criteria) {
            if (criterion.evaluate(file, content, metadata)) {
                return true
            }
        }
        return false
    }

    getSummary(): string {
        const indentedChildren = this.criteria.map(c => indentText(c.getSummary(), 2)).join('\n')
        return `OR:\n${indentedChildren}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), criteria: this.criteria.map(c => c.serialize()) }
    }

    static deserialize(data: SerializedCriterion): OrCriterion {
        return new OrCriterion((data.criteria as SerializedCriterion[]).map(c => Criterion.deserialize(c)))
    }
}

@RegisterCriterion
export class NotCriterion extends Criterion {
    constructor(public criterion: Criterion) {
        super()
    }

    evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean {
        return !this.criterion.evaluate(file, content, metadata)
    }

    getSummary(): string {
        return `NOT ${this.criterion.getSummary()}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), criterion: this.criterion.serialize() }
    }

    static deserialize(data: SerializedCriterion): NotCriterion {
        return new NotCriterion(Criterion.deserialize(data.criterion as SerializedCriterion))
    }
}

function extractTagsFromContent(content: string): string[] {
    const lines = content.split('\n')
    const tags: Set<string> = new Set()
    let inCodeBlock = false

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock
            continue
        }

        if (!inCodeBlock) {
            if (line.trim().startsWith('%%')) {
                continue
            }
            const contentTags = line.match(/#([\w-]+)/g)?.map(tag => tag.substring(1)) || []
            contentTags.forEach(tag => tags.add(tag))
        }
    }

    return Array.from(tags)
}

export function getAllTagsFromFile(file: TFile, content: string, metadata: CachedMetadata): string[] {
    const frontmatterTags = metadata?.frontmatter?.tags as unknown
    const tagsFromFrontmatter: string[] = Array.isArray(frontmatterTags)
        ? (frontmatterTags as unknown[]).map(stringifyValue)
        : (frontmatterTags ? [stringifyValue(frontmatterTags)] : [])
    const tagsFromContent = extractTagsFromContent(content)
    return [...new Set([...tagsFromFrontmatter, ...tagsFromContent])]
}

@RegisterCriterion
export class TagCriterion extends Criterion {
    constructor(public tag: string, public matchMode: TagMatchMode = TagMatchMode.StartsWith) {
        super()
    }

    evaluate(file: TFile, content: string, metadata: CachedMetadata): boolean {
        const tags = getAllTagsFromFile(file, content, metadata)
        return tags.some(tag => {
            const normalizedTag = tag.toLowerCase()
            switch (this.matchMode) {
                case TagMatchMode.Equals:
                    return normalizedTag === this.tag
                case TagMatchMode.StartsWith:
                    return normalizedTag === this.tag || normalizedTag.startsWith(this.tag + '/')
                case TagMatchMode.Includes:
                    return normalizedTag.split('/').includes(this.tag)
            }
        })
    }

    getSummary(): string {
        return `Tag: ${this.matchMode}: ${this.tag}`
    }

    serialize(): SerializedCriterion {
        return { type: this.getType(), tag: this.tag, matchMode: this.matchMode }
    }

    static deserialize(data: SerializedCriterion): TagCriterion {
        return new TagCriterion(data.tag as string, data.matchMode as TagMatchMode)
    }
}
