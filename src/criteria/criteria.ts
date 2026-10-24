import { TFile, CachedMetadata } from 'obsidian'
import { matchesGlobPatterns } from './glob'


// Type derived from class names (e.g., 'Tag' from TagCriterion)
// Leaf criteria test a note directly, group criteria hold sub-criteria
export const LEAF_CRITERION_TYPES = ['Tag', 'Frontmatter', 'Title', 'Path', 'Content'] as const
export const GROUP_CRITERION_TYPES = ['And', 'Or', 'Not'] as const
export type LeafCriterionType = typeof LEAF_CRITERION_TYPES[number]
export type GroupCriterionType = typeof GROUP_CRITERION_TYPES[number]
export type CriterionType = LeafCriterionType | GroupCriterionType

export function isGroupType(type: CriterionType): type is GroupCriterionType {
    return (GROUP_CRITERION_TYPES as readonly string[]).includes(type)
}

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
function registerCriterion<T extends CriterionClass>(constructor: T) {
    const type = constructor.name.replace('Criterion', '') as CriterionType
    registry.set(type, constructor as unknown as typeof Criterion)
}


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

@registerCriterion
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

@registerCriterion
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

@registerCriterion
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

@registerCriterion
export class PathCriterion extends PatternCriterion {
    constructor(public pattern: string, public matchMode: TextMatchMode) {
        super(pattern, matchMode)
    }

    protected getTargetValue(file: TFile): string {
        // Use forward slashes, so that glob patterns also match Windows paths
        return file.path.replace(/\\/g, '/')
    }

    static deserialize(data: SerializedCriterion): PathCriterion {
        return new PathCriterion(data.pattern as string, data.matchMode as TextMatchMode)
    }
}

function indentText(text: string, spaces: number): string {
    return text.replace(/^/gm, ' '.repeat(spaces))
}

@registerCriterion
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

@registerCriterion
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

@registerCriterion
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

// Criteria that hold sub-criteria

// Returns a copy of the sub-criteria of an And/Or/Not, or null for other criteria
export function getChildren(criterion: Criterion): Criterion[] | null {
    if (criterion instanceof AndCriterion || criterion instanceof OrCriterion) return [...criterion.criteria]
    if (criterion instanceof NotCriterion) return [criterion.criterion]
    return null
}

export function wrapCriterion(criterion: Criterion, type: GroupCriterionType): Criterion {
    switch (type) {
        case 'And': return new AndCriterion([criterion])
        case 'Or': return new OrCriterion([criterion])
        case 'Not': return new NotCriterion(criterion)
    }
}

// Converts a group to another group type, keeping its sub-criteria
export function convertGroup(group: Criterion, type: GroupCriterionType): Criterion {
    const children = getChildren(group) ?? [group]
    const [onlyChild] = children
    if (children.length === 1 && onlyChild) return wrapCriterion(onlyChild, type)
    // A Not holds one criterion, so a group with several children is negated as a whole
    if (type === 'Not') return new NotCriterion(group)
    return type === 'And' ? new AndCriterion(children) : new OrCriterion(children)
}

function extractTagsFromContent(content: string): string[] {
    const lines = content.split('\n')
    const tags: Set<string> = new Set()
    let lineIsInCodeBlock = false

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            lineIsInCodeBlock = !lineIsInCodeBlock
            continue
        }

        if (!lineIsInCodeBlock) {
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

@registerCriterion
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
