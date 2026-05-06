import { SchemaSkillStore, SkillFileEntry, SkillFileEntryWithContent, SkillFolderEntry } from "./schema";

interface MongoSkillDocument {
	kind: "file" | "folder";
	location: string;
	type: SkillFileEntry["type"] | SkillFolderEntry["type"];
	fileName?: string;
	folderName?: string;
	parentLocation?: string;
	content?: string;
}

interface MongoFindCursor<T> {
	toArray(): Promise<T[]>;
}

interface MongoSkillCollection {
	find(query: Record<string, unknown>): Promise<MongoSkillDocument[]> | MongoFindCursor<MongoSkillDocument>;
	findOne(query: Record<string, unknown>): Promise<MongoSkillDocument | null>;
	insertOne(document: MongoSkillDocument): Promise<unknown>;
	updateOne(
		filter: Record<string, unknown>,
		update: Record<string, unknown>
	): Promise<unknown>;
}

type MongoDBSkillStoreConfig = SchemaSkillStore["config"] & {
	collection: MongoSkillCollection;
	/** Optional skill root prefix in MongoDB storage (for example: "skills"). */
	root?: string;
};

type SkillStoreEntry = SkillFolderEntry | SkillFileEntry;

const SKILL_FILE_NAME = "SKILL.md";

export class MongoDBSkillStore implements SchemaSkillStore {
	config: MongoDBSkillStoreConfig;

	constructor(config: MongoDBSkillStoreConfig) {
		this.config = config;
	}

	async discoverSkillFolder(fromLocation?: string): Promise<(SkillFolderEntry | SkillFileEntry)[]> {
		try {
			const requestedLocation = this.resolveScopedLocation(fromLocation);
			const documents = await this.readDocumentsForDirectChildren(requestedLocation);

			return documents
				.map((document) => this.toSchemaEntry(document))
				.filter((entry): entry is SkillStoreEntry => entry !== null)
				.sort((a, b) => a.location.localeCompare(b.location));
		}
		catch {
			return [];
		}
	}

	async readSkillMeta(fromLocation?: string): Promise<string> {
		try {
			const skillDocument = await this.readSkillDocument(fromLocation);

			if (!skillDocument?.content) {
				return "";
			}

			return this.extractFrontmatter(skillDocument.content);
		}
		catch {
			return "";
		}
	}

	async readSkillFull(fromLocation?: string): Promise<string> {
		try {
			const skillDocument = await this.readSkillDocument(fromLocation);
			return skillDocument?.content ?? "";
		}
		catch {
			return "";
		}
	}

	async createSkillFile(skillFile: SkillFileEntryWithContent, inLocation?: string | null): Promise<boolean> {
		try {
			if (this.config.dynamicSkillCreation === false) {
				return false;
			}

			const normalizedInputLocation = this.normalizeLocation(skillFile.location);
			const fileName = this.resolveFileName(skillFile.fileName, normalizedInputLocation);

			if (!fileName.length) {
				return false;
			}

			const parentLocationInput = this.normalizeLocation(
				inLocation ?? this.parentPath(normalizedInputLocation)
			);
			const parentLocation = this.resolveScopedLocation(parentLocationInput);
			const fullLocation = parentLocation.length > 0 ? `${parentLocation}/${fileName}` : fileName;

			const existing = await this.config.collection.findOne({ location: fullLocation });

			if (existing) {
				return false;
			}

			const document: MongoSkillDocument = {
				kind: "file",
				location: fullLocation,
				type: skillFile.type,
				fileName,
				parentLocation: parentLocation.length > 0 ? parentLocation : "",
				content: skillFile.content
			};

			await this.config.collection.insertOne(document);

			return true;
		}
		catch {
			return false;
		}
	}

	async reloacateSkill(fromLocation: string, toLocation: string): Promise<boolean> {
		try {
			const normalizedFrom = this.normalizeLocation(fromLocation);

			if (!normalizedFrom.length) {
				return false;
			}

			const scopedSourceRoot = this.resolveScopedLocation(normalizedFrom);
			const scopedTargetParent = this.resolveScopedLocation(toLocation);
			const movedNodeName = this.lastPathPart(scopedSourceRoot);
			const scopedTargetRoot = scopedTargetParent.length > 0
				? `${scopedTargetParent}/${movedNodeName}`
				: movedNodeName;

			const allDocuments = await this.resolveFind(this.config.collection.find({}));
			const sourceDocuments = allDocuments.filter((document) => {
				const normalizedLocation = this.normalizeLocation(document.location);

				return normalizedLocation === scopedSourceRoot || normalizedLocation.startsWith(`${scopedSourceRoot}/`);
			});

			if (!sourceDocuments.length) {
				return false;
			}

			const sourceLocations = new Set(sourceDocuments.map((document) => this.normalizeLocation(document.location)));
			const destinationLocations = new Set(
				sourceDocuments.map((document) => this.mapRelocatedLocation(
					this.normalizeLocation(document.location),
					scopedSourceRoot,
					scopedTargetRoot
				))
			);

			const hasCollision = allDocuments.some((document) => {
				const normalizedLocation = this.normalizeLocation(document.location);

				if (sourceLocations.has(normalizedLocation)) {
					return false;
				}

				return destinationLocations.has(normalizedLocation);
			});

			if (hasCollision) {
				return false;
			}

			for (const document of sourceDocuments) {
				const oldLocation = this.normalizeLocation(document.location);
				const newLocation = this.mapRelocatedLocation(oldLocation, scopedSourceRoot, scopedTargetRoot);
				const newParentLocation = this.parentPath(newLocation);

				await this.config.collection.updateOne(
					{ location: oldLocation, kind: document.kind },
					{
						$set: {
							location: newLocation,
							parentLocation: newParentLocation.length > 0 ? newParentLocation : ""
						}
					}
				);
			}

			return true;
		}
		catch {
			return false;
		}
	}

	private async readDocumentsForDirectChildren(scopedLocation: string): Promise<MongoSkillDocument[]> {
		const byParentLocation = await this.resolveFind(
			this.config.collection.find({ parentLocation: scopedLocation })
		);

		if (byParentLocation.length > 0) {
			return byParentLocation;
		}

		const escapedScopePrefix = scopedLocation ? `${this.escapeRegex(scopedLocation)}/` : "";
		const directChildPattern = new RegExp(`^${escapedScopePrefix}[^/]+(?:/SKILL\\.md)?$`, "i");
		const byRegex = await this.resolveFind(
			this.config.collection.find({ location: directChildPattern })
		);

		if (byRegex.length > 0) {
			return byRegex;
		}

		const allDocuments = await this.resolveFind(this.config.collection.find({}));
		return allDocuments.filter((document) => this.isDirectChild(document.location, scopedLocation));
	}

	private async readSkillDocument(fromLocation?: string): Promise<MongoSkillDocument | null> {
		const scopedSkillFileLocation = this.resolveSkillFileLocation(fromLocation);

		const exactMatch = await this.config.collection.findOne({
			kind: "file",
			fileName: SKILL_FILE_NAME,
			location: scopedSkillFileLocation
		});

		if (exactMatch) {
			return exactMatch;
		}

		const scopedFolderLocation = this.resolveScopedLocation(fromLocation);

		return this.config.collection.findOne({
			kind: "file",
			fileName: SKILL_FILE_NAME,
			parentLocation: scopedFolderLocation
		});
	}

	private async resolveFind(result: Promise<MongoSkillDocument[]> | MongoFindCursor<MongoSkillDocument>): Promise<MongoSkillDocument[]> {
		if (typeof (result as MongoFindCursor<MongoSkillDocument>).toArray === "function") {
			return (result as MongoFindCursor<MongoSkillDocument>).toArray();
		}

		return result as Promise<MongoSkillDocument[]>;
	}

	private toSchemaEntry(document: MongoSkillDocument): SkillStoreEntry | null {
		if (document.kind === "folder") {
			const folderType = this.toFolderType(document.type);
			const folderLocation = this.toPublicLocation(document.location);

			return {
				type: folderType,
				folderName: folderType === "skill" || folderType === "skill-ward"
					? (document.folderName ?? this.lastPathPart(document.location))
					: undefined,
				location: folderLocation
			};
		}

		if (document.kind === "file") {
			return {
				fileName: document.fileName ?? this.lastPathPart(document.location),
				type: this.toFileType(document.type, document.fileName),
				location: this.toPublicLocation(document.location)
			};
		}

		return null;
	}

	private toFolderType(value: MongoSkillDocument["type"]): SkillFolderEntry["type"] {
		const folderTypes: SkillFolderEntry["type"][] = ["skill-ward", "skill", "scripts", "references", "assets"];

		if (folderTypes.includes(value as SkillFolderEntry["type"])) {
			return value as SkillFolderEntry["type"];
		}

		return "skill-ward";
	}

	private toFileType(value: MongoSkillDocument["type"], fileName?: string): SkillFileEntry["type"] {
		const fileTypes: SkillFileEntry["type"][] = ["skill", "script", "reference", "documentation", "assets"];

		if (fileTypes.includes(value as SkillFileEntry["type"])) {
			return value as SkillFileEntry["type"];
		}

		if ((fileName ?? "").toLowerCase() === SKILL_FILE_NAME.toLowerCase()) {
			return "skill";
		}

		return "reference";
	}

	private resolveSkillFileLocation(fromLocation?: string): string {
		const normalizedLocation = this.normalizeLocation(fromLocation);

		if (!normalizedLocation) {
			return this.resolveScopedLocation(SKILL_FILE_NAME);
		}

		if (normalizedLocation.toLowerCase() === SKILL_FILE_NAME.toLowerCase() || normalizedLocation.toLowerCase().endsWith(`/${SKILL_FILE_NAME.toLowerCase()}`)) {
			return this.resolveScopedLocation(normalizedLocation);
		}

		return this.resolveScopedLocation(`${normalizedLocation}/${SKILL_FILE_NAME}`);
	}

	private resolveScopedLocation(fromLocation?: string): string {
		const parts = [
			this.normalizeLocation(this.config.root),
			this.normalizeLocation(this.config.session),
			this.normalizeLocation(fromLocation)
		].filter((part) => part.length > 0);

		return parts.join("/");
	}

	private toPublicLocation(storedLocation: string): string {
		const normalizedStoredLocation = this.normalizeLocation(storedLocation);
		const scopePrefix = this.resolveScopedLocation();

		if (!scopePrefix) {
			return normalizedStoredLocation;
		}

		if (normalizedStoredLocation === scopePrefix) {
			return "";
		}

		if (normalizedStoredLocation.startsWith(`${scopePrefix}/`)) {
			return normalizedStoredLocation.slice(scopePrefix.length + 1);
		}

		return normalizedStoredLocation;
	}

	private isDirectChild(candidateLocation: string, parentLocation: string): boolean {
		const normalizedCandidate = this.normalizeLocation(candidateLocation);
		const normalizedParent = this.normalizeLocation(parentLocation);

		if (!normalizedParent) {
			return normalizedCandidate.split("/").length <= 2;
		}

		if (!normalizedCandidate.startsWith(`${normalizedParent}/`)) {
			return false;
		}

		const rest = normalizedCandidate.slice(normalizedParent.length + 1);
		const restDepth = rest.split("/").length;

		return restDepth <= 2;
	}

	private lastPathPart(location: string): string {
		const normalizedLocation = this.normalizeLocation(location);
		const chunks = normalizedLocation.split("/");

		return chunks[chunks.length - 1] ?? "";
	}

	private parentPath(location: string): string {
		const normalizedLocation = this.normalizeLocation(location);

		if (!normalizedLocation.length || !normalizedLocation.includes("/")) {
			return "";
		}

		return normalizedLocation.slice(0, normalizedLocation.lastIndexOf("/"));
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

		return this.lastPathPart(normalizedFallback);
	}

	private mapRelocatedLocation(location: string, fromRoot: string, toRoot: string): string {
		if (location === fromRoot) {
			return toRoot;
		}

		if (location.startsWith(`${fromRoot}/`)) {
			return `${toRoot}${location.slice(fromRoot.length)}`;
		}

		return location;
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

	private escapeRegex(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private extractFrontmatter(content: string): string {
		const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);

		if (!frontmatterMatch) {
			return "";
		}

		return frontmatterMatch[0].trim();
	}
}
