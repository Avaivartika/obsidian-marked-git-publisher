/** Persist source creation time in the published copy, without editing the vault. */
export function withCreationTime(content: string, ctime: number): string {
    if (!Number.isFinite(ctime) || ctime <= 0) return content
    const created = new Date(ctime).toISOString()
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (frontmatter) {
        if (/^created\s*:/m.test(frontmatter[1]!)) return content
        return content.replace(/^(---\r?\n)/, `$1created: "${created}"\n`)
    }
    return `---\ncreated: "${created}"\n---\n${content}`
}
