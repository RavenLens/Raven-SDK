import fs from "node:fs";
import path from "node:path";
import { SchemaSkillStore, SkillFileEntry, SkillFileEntryWithContent, SkillFolderEntry } from "./schema";

type SkillDiskStoreConfig = SchemaSkillStore["config"] & {
    rootDir?: string;
};

type SkillStoreEntry = SkillFolderEntry | SkillFileEntry;

const SKILL_FILE_NAME = "SKILL.md";

export class SkillDiskStore implements SchemaSkillStore {
    config: SkillDiskStoreConfig;
    private rootDir: string;

    constructor(config: SkillDiskStoreConfig = {}) {
        this.config = config;
        this.rootDir = config.rootDir ?? path.join(process.cwd(), "skills");
    }

    discoverSkillFolder(fromLocation?: string): (SkillFolderEntry | SkillFileEntry)[] {
        try {
            const locationToRead = this.resolveLocation(fromLocation);

            if (!fs.existsSync(locationToRead) || !fs.statSync(locationToRead).isDirectory()) {
                return [];
            }

            const entries = fs.readdirSync(locationToRead, { withFileTypes: true });
            const discoveredEntries = entries
                .map((entry): SkillStoreEntry | null => {
                    const absoluteEntryPath = path.join(locationToRead, entry.name);
                    const entryLocation = this.toScopeRelativeLocation(absoluteEntryPath);

                    if (entry.isDirectory()) {
                        const folderType = this.inferFolderType(entry.name, absoluteEntryPath);

                        return {
                            type: folderType,
                            folderName: folderType === "skill" || folderType === "skill-ward" ? entry.name : undefined,
                            location: entryLocation
                        };
                    }

                    if (entry.isFile()) {
                        return {
                            fileName: entry.name,
                            type: this.inferFileType(entry.name),
                            location: entryLocation
                        };
                    }

                    return null;
                })
                .filter((entry): entry is SkillStoreEntry => entry !== null)
                .sort((a, b) => a.location.localeCompare(b.location));

            return discoveredEntries;
        }
        catch {
            return [];
        }
    }

    readSkillMeta(fromLocation?: string): string {
        try {
            const skillFilePath = this.resolveSkillFilePath(fromLocation);

            if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
                return "";
            }

            const skillContent = fs.readFileSync(skillFilePath, "utf8");
            return this.extractFrontmatter(skillContent);
        }
        catch {
            return "";
        }
    }
    
    readSkillFull(fromLocation?: string): string {
        try {
            const skillFilePath = this.resolveSkillFilePath(fromLocation);

            if (!fs.existsSync(skillFilePath) || !fs.statSync(skillFilePath).isFile()) {
                return "";
            }

            return fs.readFileSync(skillFilePath, "utf8");
        }
        catch {
            return "";
        }
    }

    createSkillFile(skillFile: SkillFileEntryWithContent, inLocation?: string | null): boolean {
        try {
            if (this.config.dynamicSkillCreation === false) {
                return false;
            }

            const normalizedInputLocation = this.normalizeLocation(skillFile.location);
            const normalizedBaseLocation = this.normalizeLocation(
                inLocation ?? path.posix.dirname(normalizedInputLocation)
            );
            const resolvedFileName = this.resolveFileName(skillFile.fileName, normalizedInputLocation);

            if (!resolvedFileName.length) {
                return false;
            }

            const relativeFileLocation = this.normalizeLocation(
                normalizedBaseLocation.length > 0
                    ? path.posix.join(normalizedBaseLocation, resolvedFileName)
                    : resolvedFileName
            );
            const absoluteFileLocation = this.resolveLocation(relativeFileLocation);

            fs.mkdirSync(path.dirname(absoluteFileLocation), { recursive: true });
            fs.writeFileSync(absoluteFileLocation, skillFile.content, "utf8");

            return true;
        }
        catch {
            return false;
        }
    }

    reloacateSkill(fromLocation: string, toLocation: string): boolean {
        try {
            const normalizedFromLocation = this.normalizeLocation(fromLocation);
            const normalizedToLocation = this.normalizeLocation(toLocation);

            if (!normalizedFromLocation.length) {
                return false;
            }

            const sourcePath = this.resolveLocation(normalizedFromLocation);

            if (!fs.existsSync(sourcePath)) {
                return false;
            }

            const destinationParentPath = this.resolveLocation(normalizedToLocation);
            const destinationPath = path.join(destinationParentPath, path.basename(sourcePath));

            if (sourcePath === destinationPath || fs.existsSync(destinationPath)) {
                return false;
            }

            fs.mkdirSync(destinationParentPath, { recursive: true });
            fs.renameSync(sourcePath, destinationPath);

            return true;
        }
        catch {
            return false;
        }
    }

    private getSessionRoot(): string {
        const normalizedSession = this.normalizeLocation(this.config.session);

        if (!normalizedSession) {
            return this.rootDir;
        }

        return path.join(this.rootDir, ...normalizedSession.split("/"));
    }

    private resolveLocation(fromLocation?: string): string {
        const sessionRoot = this.getSessionRoot();
        const normalizedLocation = this.normalizeLocation(fromLocation);

        if (!normalizedLocation) {
            return sessionRoot;
        }

        return path.join(sessionRoot, ...normalizedLocation.split("/"));
    }

    private resolveSkillFilePath(fromLocation?: string): string {
        const normalizedLocation = this.normalizeLocation(fromLocation);

        if (!normalizedLocation) {
            return path.join(this.getSessionRoot(), SKILL_FILE_NAME);
        }

        if (normalizedLocation.toLowerCase() === SKILL_FILE_NAME.toLowerCase() || normalizedLocation.toLowerCase().endsWith(`/${SKILL_FILE_NAME.toLowerCase()}`)) {
            return this.resolveLocation(normalizedLocation);
        }

        return path.join(this.resolveLocation(normalizedLocation), SKILL_FILE_NAME);
    }

    private toScopeRelativeLocation(absolutePath: string): string {
        const relativePath = path.relative(this.getSessionRoot(), absolutePath);
        return this.normalizeLocation(relativePath);
    }

    private normalizeLocation(location?: string): string {
        if (!location) {
            return "";
        }

        return location
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");
    }

    private resolveFileName(fileName?: string, fallbackLocation?: string): string {
        const normalizedFileName = (fileName ?? "").trim();

        if (normalizedFileName.length > 0) {
            return normalizedFileName;
        }

        const normalizedFallback = this.normalizeLocation(fallbackLocation);

        if (!normalizedFallback.length) {
            return "";
        }

        return path.posix.basename(normalizedFallback);
    }

    private inferFolderType(folderName: string, absolutePath: string): SkillFolderEntry["type"] {
        const normalizedName = folderName.toLowerCase();

        if (normalizedName === "scripts") {
            return "scripts";
        }

        if (normalizedName === "references") {
            return "references";
        }

        if (normalizedName === "assets") {
            return "assets";
        }

        if (fs.existsSync(path.join(absolutePath, SKILL_FILE_NAME))) {
            return "skill";
        }

        return "skill-ward";
    }

    private inferFileType(fileName: string): SkillFileEntry["type"] {
        const normalizedName = fileName.toLowerCase();

        if (normalizedName === SKILL_FILE_NAME.toLowerCase()) {
            return "skill";
        }

        if (/\.(ts|tsx|js|jsx|mjs|cjs|py|sh|ps1|rb|go)$/.test(normalizedName)) {
            return "script";
        }

        if (/\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|gz)$/.test(normalizedName)) {
            return "assets";
        }

        if (/\.(md|txt|rst)$/.test(normalizedName)) {
            return "documentation";
        }

        return "reference";
    }

    private extractFrontmatter(content: string): string {
        const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);

        if (!frontmatterMatch) {
            return "";
        }

        return frontmatterMatch[0].trim();
    }
}
