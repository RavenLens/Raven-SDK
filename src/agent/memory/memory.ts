import z from "zod";
import { tool, Tool } from "../tools/tools";
import { MemoryFetch, MemoryRecord } from "./stores/schema";
import { SchemaMemoryStore } from "./stores/schema";

export class Memory<MemoryStore extends SchemaMemoryStore> {
    static memorySystemPrompt: string = [
        "You have access to long-term memory through two tools: `fetch_memory` and `save_memory`.",
        "Follow this process:",
        "1. Before answering, decide whether the current task depends on durable facts, prior preferences, user identity, recurring goals, or established decisions.",
        "2. If memory can help, call `fetch_memory` first to look for matching knowledge.",
        "3. Use `fetch_memory` with semantic search for keywords, titles, content, and related memory ids.",
        "4. Use `fetch_memory` in explore mode when you need to walk outward from a known memory node and inspect connected knowledge.",
        "5. After reading memory, answer with the stored facts instead of guessing.",
        "6. Save new memory only when the information is durable, useful later, and does not already exist in saved memory.",
        "7. Before calling `save_memory`, compare the new fact with fetched memory. If it is already stored, do not save it again.",
        "8. Save only stable information such as preferences, profile facts, task constraints, decisions, terminology, and important outcomes.",
        "9. Do not save transient chat noise, repeated tool output, secrets, or speculative guesses.",
        "10. When saving related facts, attach related memory ids and strength values in the range 0 to 1 when known.",
        "11. Prefer short, normalized titles and clear content that can be reused in later turns.",
        "12. If you are unsure whether a fact is worth remembering, fetch first and save only if it is genuinely new and durable."
    ].join("\n");
    store: MemoryStore;

    constructor(store: MemoryStore) {
        this.store = store;
    }

    createMemoryTools(): Tool<any, any>[] {
        const fetchMemoryArguments = z.object({
            mode: z.enum(["semantic", "explore"]).default("semantic"),
            words: z.union([z.string(), z.array(z.string())]).optional(),
            reason: z.string().optional()
        }).passthrough();

        const saveMemoryArguments = z.object({
            record: z.object({
                id: z.string().min(1),
                title: z.string().min(1),
                content: z.string().min(1),
                keywords: z.array(z.string()).default([]),
                subMemoryIds: z.array(z.object({
                    id: z.string().min(1),
                    strength: z.number().min(0).max(1).optional()
                })).default([])
            }),
            // Optional extra hint used to search for duplicates before saving.
            words: z.union([z.string(), z.array(z.string())]).optional()
        }).passthrough();

        const memoryTools: Tool<any, any>[] = [
            tool(
                async (args) => {
                    const result = args.mode === "explore"
                        ? await this.store.fetchMemory(MemoryFetch.Explore)
                        : await this.store.fetchMemory({
                            by: MemoryFetch.Sematic,
                            words: this.normalizeFetchWords(args.words)
                        });

                    return this.serializeToolResult(result ?? null);
                },
                {
                    toolName: "fetch_memory",
                    toolDescription: [
                        "Search long-term memory for relevant knowledge.",
                        "Use mode='semantic' for title/content/keyword based lookup.",
                        "Use mode='explore' to traverse connected memory nodes.",
                        "Prefer semantic lookup first, then explore if you need neighbors or follow-up context."
                    ].join(" "),
                    toolArguments: fetchMemoryArguments
                }
            ),
            tool(
                async (args) => {
                    const record = this.normalizeMemoryRecord(args.record);

                    if (!record) {
                        return this.serializeToolResult({
                            saved: false,
                            reason: "Invalid memory record payload"
                        });
                    }

                    const duplicate = await this.findDuplicateRecord(record, args.words);

                    if (duplicate) {
                        return this.serializeToolResult({
                            saved: false,
                            skipped: true,
                            reason: "Matching memory already exists",
                            matchedMemory: duplicate
                        });
                    }

                    const saved = await this.store.saveMemory(record);

                    return this.serializeToolResult({
                        saved,
                        record
                    });
                },
                {
                    toolName: "save_memory",
                    toolDescription: [
                        "Persist a new durable memory node only when it is genuinely new.",
                        "Before saving, the agent should fetch memory and compare against existing facts.",
                        "Use this tool for stable information such as user preferences, profile facts, goals, decisions, terminology, and important outcomes.",
                        "Do not save duplicates, transient chat noise, secrets, or uncertain guesses."
                    ].join(" "),
                    toolArguments: saveMemoryArguments
                }
            )
        ];

        return memoryTools;
    }

    private normalizeFetchWords(words?: string | string[]): string | string[] {
        if (words === undefined) {
            return "";
        }

        if (Array.isArray(words)) {
            return words.map(word => word.trim()).filter(Boolean);
        }

        return words.trim();
    }

    private normalizeMemoryRecord(record: MemoryRecord): MemoryRecord | null {
        const id = record.id.trim();
        const title = record.title.trim();
        const content = record.content.trim();

        if (!id || !title || !content) {
            return null;
        }

        const keywords = record.keywords
            .map(keyword => keyword.trim())
            .filter(Boolean);

        const subMemoryIds = record.subMemoryIds
            .map((relation) => ({
                id: relation.id.trim(),
                ...(typeof relation.strength === "number" ? { strength: this.clampStrength(relation.strength) } : {})
            }))
            .filter((relation) => relation.id.length > 0);

        return {
            id,
            title,
            content,
            keywords,
            subMemoryIds
        };
    }

    private async findDuplicateRecord(record: MemoryRecord, words?: string | string[]): Promise<MemoryRecord | undefined> {
        const searchWords = this.buildDuplicateSearchWords(record, words);

        if (!searchWords.length) {
            return undefined;
        }

        const existing = await this.store.fetchMemory({
            by: MemoryFetch.Sematic,
            words: searchWords
        });

        if (!existing) {
            return undefined;
        }

        if (this.isDuplicateMemory(existing, record)) {
            return existing;
        }

        return undefined;
    }

    private buildDuplicateSearchWords(record: MemoryRecord, words?: string | string[]): string[] {
        const seedWords = Array.isArray(words)
            ? words
            : typeof words === "string"
                ? [words]
                : [];

        return [
            ...seedWords,
            record.id,
            record.title,
            record.content,
            ...record.keywords,
            ...record.subMemoryIds.map((relation) => relation.id)
        ]
            .map((word) => word.trim())
            .filter((word) => word.length > 0);
    }

    private isDuplicateMemory(existing: MemoryRecord, incoming: MemoryRecord): boolean {
        if (existing.id === incoming.id) {
            return true;
        }

        const existingTitle = this.normalizeText(existing.title);
        const incomingTitle = this.normalizeText(incoming.title);
        const existingContent = this.normalizeText(existing.content);
        const incomingContent = this.normalizeText(incoming.content);

        if (existingTitle === incomingTitle && existingContent === incomingContent) {
            return true;
        }

        if (existingContent === incomingContent) {
            const existingKeywords = new Set(existing.keywords.map((keyword) => this.normalizeText(keyword)));
            const incomingKeywords = new Set(incoming.keywords.map((keyword) => this.normalizeText(keyword)));

            const keywordOverlap = [...incomingKeywords].filter((keyword) => existingKeywords.has(keyword)).length;
            const largestKeywordSet = Math.max(existingKeywords.size, incomingKeywords.size, 1);

            if (keywordOverlap / largestKeywordSet >= 0.5) {
                return true;
            }
        }

        if (existingTitle === incomingTitle) {
            if (
                existingContent.includes(incomingContent) ||
                incomingContent.includes(existingContent)
            ) {
                return true;
            }
        }

        return false;
    }

    private normalizeText(value: string): string {
        return value.trim().toLowerCase().replace(/\s+/g, " ");
    }

    private clampStrength(value: number): number {
        if (Number.isNaN(value)) {
            return 0;
        }

        if (value < 0) {
            return 0;
        }

        if (value > 1) {
            return 1;
        }

        return value;
    }

    private serializeToolResult(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }

        try {
            return JSON.stringify(value, null, 2);
        }
        catch {
            return String(value);
        }
    }
}
