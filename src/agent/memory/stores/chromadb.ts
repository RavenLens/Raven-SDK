import { FetchBySemantic, MemoryFetch, MemoryFetchResult, MemoryRecord, SchemaMemoryConfig, SchemaMemoryStore } from "./schema";
import { ChromaClient, ChromaClientArgs } from "chromadb";

export interface ChromaDBConfig extends SchemaMemoryConfig {
    chromaDBConfig?: ChromaClientArgs;
}

type ChromaMetadataValue = string | number | boolean | null;
type ChromaMetadata = Record<string, ChromaMetadataValue>;

interface ChromaGetResult {
    ids?: string[];
    documents?: Array<string | null>;
    metadatas?: Array<ChromaMetadata | null>;
}

interface ChromaQueryResult {
    ids?: string[][];
    documents?: Array<Array<string | null>>;
    metadatas?: Array<Array<ChromaMetadata | null>>;
}

interface ChromaCollection {
    add?: (params: { ids: string[]; documents?: string[]; metadatas?: ChromaMetadata[]; }) => Promise<unknown>;
    upsert?: (params: { ids: string[]; documents?: string[]; metadatas?: ChromaMetadata[]; }) => Promise<unknown>;
    get?: (params?: { ids?: string[]; include?: string[]; limit?: number; offset?: number; where?: Record<string, unknown>; }) => Promise<ChromaGetResult>;
    query?: (params: { queryTexts?: string[]; nResults?: number; include?: string[]; where?: Record<string, unknown>; }) => Promise<ChromaQueryResult>;
}

interface ChromaClientWithCollections {
    getOrCreateCollection?: (params: { name: string; metadata?: ChromaMetadata; }) => Promise<ChromaCollection>;
    getCollection?: (params: { name: string; }) => Promise<ChromaCollection>;
    createCollection?: (params: { name: string; metadata?: ChromaMetadata; }) => Promise<ChromaCollection>;
}

export class MemoryChromaDBStore implements SchemaMemoryStore {
    private chromadbClient: ChromaClient;
    private collectionPromise: Promise<ChromaCollection> | undefined;
    config: ChromaDBConfig;

    constructor(config: ChromaDBConfig) {
        this.config = config;
        this.chromadbClient = new ChromaClient(config.chromaDBConfig);
    }

    async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
        try {
            const collection = await this.getCollection();

            if (fetchBy === MemoryFetch.Explore) {
                return this.fetchByExplore(collection);
            }

            return this.fetchBySemantic(collection, fetchBy);
        }
        catch {
            return undefined;
        }
    }

    async saveMemory(records: MemoryRecord): Promise<boolean> {
        try {
            const collection = await this.getCollection();
            const metadata = this.createMetadata(records);
            const document = this.createSemanticDocument(records);

            if (typeof collection.upsert === "function") {
                await collection.upsert({
                    ids: [records.id],
                    documents: [document],
                    metadatas: [metadata]
                });

                return true;
            }

            if (typeof collection.add === "function") {
                await collection.add({
                    ids: [records.id],
                    documents: [document],
                    metadatas: [metadata]
                });

                return true;
            }

            return false;
        }
        catch {
            return false;
        }
    }

    private async fetchBySemantic(collection: ChromaCollection, fetchBy: FetchBySemantic): Promise<MemoryFetchResult> {
        const words = this.normalizeWords(fetchBy.words);

        if (words.length === 0) {
            return undefined;
        }

        const searchText = words.join(" ");
        const sessionWhere = this.resolveSessionWhere();

        if (typeof collection.query === "function") {
            const queryResult = await collection.query({
                queryTexts: [searchText],
                nResults: this.resolveSemanticResultLimit(words),
                include: ["documents", "metadatas"],
                ...(sessionWhere ? { where: sessionWhere } : {})
            });

            const ids = queryResult.ids?.[0] ?? [];
            const metadatas = queryResult.metadatas?.[0] ?? [];
            const documents = queryResult.documents?.[0] ?? [];

            if (ids.length === 0) {
                return undefined;
            }

            return ids.map((id, index) => this.toMemoryRecord(
                id,
                metadatas[index] ?? null,
                documents[index] ?? null
            ));
        }

        if (typeof collection.get !== "function") {
            return undefined;
        }

        const fallbackResults = await collection.get({
            include: ["documents", "metadatas"],
            limit: 100,
            ...(sessionWhere ? { where: sessionWhere } : {})
        });

        return this.findByKeywordScore(fallbackResults, words);
    }

    private async fetchByExplore(collection: ChromaCollection): Promise<MemoryFetchResult> {
        if (typeof collection.get !== "function") {
            return undefined;
        }

        const sessionWhere = this.resolveSessionWhere();

        const results = await collection.get({
            include: ["documents", "metadatas"],
            limit: 100,
            ...(sessionWhere ? { where: sessionWhere } : {})
        });

        const ids = results.ids ?? [];

        if (ids.length === 0) {
            return undefined;
        }

        let selectedIndex = 0;
        let selectedScore = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < ids.length; index += 1) {
            const metadata = results.metadatas?.[index] ?? null;
            const relationCount = this.parseNumber(metadata?.relationCount, 0);
            const maxRelationStrength = this.parseNumber(metadata?.maxRelationStrength, 0);
            const score = relationCount + maxRelationStrength;

            if (score > selectedScore) {
                selectedScore = score;
                selectedIndex = index;
            }
        }

        const id = ids[selectedIndex];
        const metadata = results.metadatas?.[selectedIndex] ?? null;
        const document = results.documents?.[selectedIndex] ?? null;

        return this.toMemoryRecord(id, metadata, document);
    }

    private findByKeywordScore(results: ChromaGetResult, words: string[]): MemoryFetchResult {
        const ids = results.ids ?? [];

        if (ids.length === 0) {
            return undefined;
        }

        const loweredWords = words.map(word => word.toLowerCase());
        const scoredResults = ids
            .map((id, index) => {
                const metadata = results.metadatas?.[index] ?? null;
                const document = results.documents?.[index] ?? "";
                const searchableBlob = [
                    document,
                    String(metadata?.title ?? ""),
                    String(metadata?.content ?? ""),
                    String(metadata?.keywords ?? ""),
                    String(metadata?.relatedMemoryIds ?? ""),
                    String(metadata?.relationStrengths ?? "")
                ].join("\n").toLowerCase();

                const score = loweredWords.reduce((total, word) => total + (searchableBlob.includes(word) ? 1 : 0), 0);

                return {
                    id,
                    metadata,
                    document,
                    score,
                    index
                };
            })
            .filter((entry) => entry.id.trim().length > 0)
            .sort((left, right) => right.score - left.score || left.index - right.index);

        if (scoredResults.length === 0) {
            return undefined;
        }

        return scoredResults.map((entry) => this.toMemoryRecord(
            entry.id,
            entry.metadata,
            entry.document
        ));
    }

    private toMemoryRecord(id: string, metadata: ChromaMetadata | null, document: string | null): MemoryRecord {
        const keywords = this.parseStringArray(metadata?.keywords);
        const subMemoryIds = this.parseSubMemoryIds(metadata?.subMemoryIds);

        return {
            id,
            title: String(metadata?.title ?? "").trim(),
            content: String(metadata?.content ?? document ?? "").trim(),
            keywords,
            subMemoryIds
        };
    }

    private createMetadata(record: MemoryRecord): ChromaMetadata {
        const normalizedKeywords = record.keywords.map(keyword => keyword.trim()).filter(Boolean);
        const normalizedRelations = record.subMemoryIds
            .map(relation => ({
                id: relation.id.trim(),
                strength: this.normalizeStrength(relation.strength)
            }))
            .filter(relation => relation.id.length > 0);
        const maxRelationStrength = normalizedRelations.reduce(
            (max, relation) => Math.max(max, relation.strength ?? 0),
            0
        );

        return {
            title: record.title,
            content: record.content,
            keywords: JSON.stringify(normalizedKeywords),
            relatedMemoryIds: normalizedRelations.map(relation => relation.id).join(" "),
            relationStrengths: normalizedRelations.map(relation => `${relation.id}:${relation.strength ?? 0}`).join(" "),
            subMemoryIds: JSON.stringify(normalizedRelations),
            relationCount: normalizedRelations.length,
            maxRelationStrength,
            session: this.resolveSession() ?? ""
        };
    }

    private createSemanticDocument(record: MemoryRecord): string {
        const relatedDescriptions = record.subMemoryIds
            .map(relation => `${relation.id} (${this.normalizeStrength(relation.strength) ?? 0})`)
            .join(", ");

        return [
            `title: ${record.title}`,
            `keywords: ${record.keywords.join(", ")}`,
            `related: ${relatedDescriptions}`,
            "content:",
            record.content
        ].join("\n");
    }

    private normalizeWords(words: string | string[]): string[] {
        const normalizedWords = Array.isArray(words) ? words : [words];
        return normalizedWords
            .map(word => word.trim())
            .filter(word => word.length > 0);
    }

    private parseStringArray(value: ChromaMetadataValue | undefined): string[] {
        if (typeof value !== "string") {
            return [];
        }

        try {
            const parsedValue = JSON.parse(value) as unknown;

            if (Array.isArray(parsedValue)) {
                return parsedValue
                    .map(item => String(item).trim())
                    .filter(Boolean);
            }
        }
        catch {
            return value
                .split(/[\s,]+/)
                .map(item => item.trim())
                .filter(Boolean);
        }

        return [];
    }

    private parseSubMemoryIds(value: ChromaMetadataValue | undefined): MemoryRecord["subMemoryIds"] {
        if (typeof value !== "string") {
            return [];
        }

        try {
            const parsedValue = JSON.parse(value) as unknown;

            if (!Array.isArray(parsedValue)) {
                return [];
            }

            const relations = parsedValue
                .map((entry): MemoryRecord["subMemoryIds"][number] | null => {
                    const relation = entry as { id?: unknown; strength?: unknown; };
                    const id = String(relation.id ?? "").trim();

                    if (!id.length) {
                        return null;
                    }

                    const normalizedStrength = this.normalizeStrength(relation.strength);

                    return {
                        id,
                        ...(normalizedStrength === undefined ? {} : { strength: normalizedStrength })
                    };
                })
                .filter((entry): entry is MemoryRecord["subMemoryIds"][number] => entry !== null);

            return relations;
        }
        catch {
            return [];
        }
    }

    private normalizeStrength(strength: unknown): number | undefined {
        if (typeof strength !== "number" || Number.isNaN(strength)) {
            return undefined;
        }

        if (strength <= 0) {
            return 0;
        }

        if (strength >= 1) {
            return 1;
        }

        return strength;
    }

    private parseNumber(value: ChromaMetadataValue | undefined, fallback: number): number {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string") {
            const parsed = Number(value);

            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return fallback;
    }

    private resolveSession(): string | undefined {
        const session = this.config.session?.trim();

        if (!session) {
            return undefined;
        }

        return session;
    }

    private resolveSessionWhere(): Record<string, unknown> | undefined {
        const session = this.resolveSession();

        if (!session) {
            return undefined;
        }

        return {
            session
        };
    }

    private resolveSemanticResultLimit(words: string[]): number {
        return Math.min(Math.max(words.length * 2, 5), 10);
    }

    private async getCollection(): Promise<ChromaCollection> {
        if (!this.collectionPromise) {
            this.collectionPromise = this.createCollection();
        }

        return this.collectionPromise;
    }

    private async createCollection(): Promise<ChromaCollection> {
        const collectionName = this.resolveCollectionName();
        const chromaClient = this.chromadbClient as unknown as ChromaClientWithCollections;

        if (typeof chromaClient.getOrCreateCollection === "function") {
            return chromaClient.getOrCreateCollection({
                name: collectionName,
                metadata: {
                    source: "raven-adk-memory-store"
                }
            });
        }

        if (typeof chromaClient.getCollection === "function") {
            try {
                return await chromaClient.getCollection({ name: collectionName });
            }
            catch {
                if (typeof chromaClient.createCollection === "function") {
                    return chromaClient.createCollection({
                        name: collectionName,
                        metadata: {
                            source: "raven-adk-memory-store"
                        }
                    });
                }

                throw new Error("Unable to create or retrieve ChromaDB collection");
            }
        }

        throw new Error("ChromaDB client does not support collection management methods");
    }

    private resolveCollectionName(): string {
        const session = (this.resolveSession() ?? "default")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "-")
            .replace(/-{2,}/g, "-")
            .replace(/^-+|-+$/g, "");

        return `raven-agent-memory-${session || "default"}`;
    }
}
