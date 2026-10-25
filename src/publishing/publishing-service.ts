import { App, TFile } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { Buffer } from 'buffer'
import { GitHelper } from './git-helper'
import { FileDiff } from './diff-parser'

export enum FileUpdateStatus {
    New = 'new',
    Modified = 'modified',
    Unmodified = 'unmodified',
    Deleted = 'deleted',
}

export interface FileWithStatus {
    path: string
    status: FileUpdateStatus
}

export class PublishingService {
    private publishedPaths = new Set<string>()
    constructor(private app: App, private repoPath: string) { }

    private setPublishableFiles(files: TFile[]) {
        this.publishedPaths = new Set(files.map(file => file.path))
    }

    public async getPublishingStatuses(publishableFiles: TFile[]): Promise<FileWithStatus[]> {
        this.setPublishableFiles(publishableFiles)
        const fileStatuses = await Promise.all(publishableFiles.map(async file => ({
            path: file.path,
            status: await this.getFileStatus(file),
        })))
        const published = await this.getPublishedFiles()
        const deleted = published.filter(item => !this.publishedPaths.has(item))
            .map(item => ({ path: item, status: FileUpdateStatus.Deleted }))
        return [...fileStatuses, ...deleted]
    }

    public async updateFilesInRepo(publishableFiles: TFile[]): Promise<void> {
        this.setPublishableFiles(publishableFiles)
        await this.cleanupRepo()
        for (const file of publishableFiles) await this.copyFileToRepo(file)
    }

    public async getFileDiff(filePath: string): Promise<FileDiff> {
        const file = this.app.vault.getAbstractFileByPath(filePath)
        if (!(file instanceof TFile)) throw new Error(`找不到笔记：${filePath}`)
        const oldPath = this.resolveRepoPath(filePath)
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-git-diff-'))
        try {
            const currentPath = path.join(directory, file.name)
            await fs.writeFile(currentPath, await this.fileBytes(file))
            return await GitHelper.diffFiles(this.repoPath, oldPath, currentPath)
        } finally {
            await fs.rm(directory, { recursive: true, force: true })
        }
    }

    private resolveRepoPath(relativePath: string): string {
        return path.join(this.repoPath, relativePath)
    }

    private async fileBytes(file: TFile): Promise<Buffer> {
        if (file.extension === 'md') {
            const content = await this.app.vault.read(file)
            return Buffer.from(this.processContent(content, file), 'utf8')
        }
        return Buffer.from(await this.app.vault.readBinary(file))
    }

    private processContent(content: string, file: TFile): string {
        const relativeLink = (target: TFile) => {
            const relative = path.posix.relative(path.posix.dirname(file.path), target.path)
            return relative.split('/').map(part => encodeURIComponent(part)).join('/')
        }
        const label = (value: string) => value.replace(/[[\]]/g, '')
        content = content.replace(/(!?)\[\[([^\]\n]+)\]\]/g, (original, embed: string, inside: string) => {
            const [raw, alias] = inside.split('|', 2) as [string, string | undefined]
            const [linkText] = raw.split('#', 1)
            const target = this.app.metadataCache.getFirstLinkpathDest(linkText || '', file.path)
            const title = label(alias?.trim() || target?.basename || raw)
            if (!(target instanceof TFile) || !this.publishedPaths.has(target.path)) {
                return embed ? original : title
            }
            const url = relativeLink(target)
            return embed && target.extension !== 'md' ? `![${title}](${url})` : `[${title}](${url})`
        })
        content = content.replace(/!\[([^\]\n]*)\]\((<[^>]+>|[^)\n]+)\)/g, (original, alt: string, raw: string) => {
            const link = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
            if (/^(https?:|data:)/i.test(link)) return original
            const target = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(link.split('#')[0] || ''), file.path)
            if (!(target instanceof TFile) || !this.publishedPaths.has(target.path)) return original
            return `![${label(alt)}](${relativeLink(target)})`
        })
        return content
    }

    private async getFileStatus(file: TFile): Promise<FileUpdateStatus> {
        try {
            const current = await this.fileBytes(file)
            const published = await fs.readFile(this.resolveRepoPath(file.path))
            return current.equals(published) ? FileUpdateStatus.Unmodified : FileUpdateStatus.Modified
        } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') return FileUpdateStatus.New
            throw error
        }
    }

    private async getPublishedFiles(): Promise<string[]> {
        const published: string[] = []
        const scan = async (directory: string) => {
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                if (entry.name.startsWith('.')) continue
                const fullPath = path.join(directory, entry.name)
                if (entry.isDirectory()) await scan(fullPath)
                else if (entry.isFile()) published.push(path.relative(this.repoPath, fullPath).split(path.sep).join('/'))
            }
        }
        await scan(this.repoPath)
        return published
    }

    private async cleanupRepo() {
        for (const existing of await this.getPublishedFiles()) {
            if (!this.publishedPaths.has(existing)) await fs.unlink(this.resolveRepoPath(existing))
        }
    }

    private async copyFileToRepo(file: TFile) {
        const dest = this.resolveRepoPath(file.path)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.writeFile(dest, await this.fileBytes(file))
    }
}
