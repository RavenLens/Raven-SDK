import { beforeEach, describe, expect, it, vi } from "vitest";
import { Memory } from "../../src/agent/memory/memory";
import { MemoryFetch, MemoryRecord, SchemaMemoryStore } from "../../src/agent/memory/stores/schema";
import { MemoryChromaDBStore } from "../../src/agent/memory/stores/chromadb";

const { chromaClientCtorMock, getOrCreateCollectionMock, queryMock, upsertMock } = vi.hoisted(() => ({
    chromaClientCtorMock: vi.fn(),
    getOrCreateCollectionMock: vi.fn(),
    queryMock: vi.fn(),
    upsertMock: vi.fn()
}));

vi.mock("chromadb", () => ({
    ChromaClient: class {
        getOrCreateCollection = getOrCreateCollectionMock;

        constructor(config: unknown) {
            chromaClientCtorMock(config);
        }
    }
}));

describe("MemoryChromaDBStore", () => {
    beforeEach(() => {
        chromaClientCtorMock.mockReset();
        getOrCreateCollectionMock.mockReset();
        queryMock.mockReset();
        upsertMock.mockReset();
    });

    it("returns multiple semantic matches and scopes reads to the configured session", async () => {
        getOrCreateCollectionMock.mockResolvedValueOnce({
            query: queryMock,
            upsert: upsertMock,
            get: vi.fn()
        });

        queryMock.mockResolvedValueOnce({
            ids: [["memory-1", "memory-2"]],
            documents: [["first document", "second document"]],
            metadatas: [[
                {
                    title: "First",
                    content: "First content",
                    keywords: JSON.stringify(["alpha", "beta"]),
                    subMemoryIds: JSON.stringify([]),
                    session: "session-a"
                },
                {
                    title: "Second",
                    content: "Second content",
                    keywords: JSON.stringify(["gamma"]),
                    subMemoryIds: JSON.stringify([{ id: "memory-1", strength: 0.75 }]),
                    session: "session-a"
                }
            ]]
        });

        const store = new MemoryChromaDBStore({
            hasToRemember: "Remember user preferences",
            session: "  session-a  "
        });

        const result = await store.fetchMemory({
            by: MemoryFetch.Sematic,
            words: ["alpha", "beta"]
        });

        expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({
            queryTexts: ["alpha beta"],
            nResults: 5,
            include: ["documents", "metadatas"],
            where: {
                session: "session-a"
            }
        }));
        expect(result).toStrictEqual([
            {
                id: "memory-1",
                title: "First",
                content: "First content",
                keywords: ["alpha", "beta"],
                subMemoryIds: []
            },
            {
                id: "memory-2",
                title: "Second",
                content: "Second content",
                keywords: ["gamma"],
                subMemoryIds: [
                    {
                        id: "memory-1",
                        strength: 0.75
                    }
                ]
            }
        ]);
    });

    it("stores session metadata when saving memory", async () => {
        getOrCreateCollectionMock.mockResolvedValueOnce({
            query: queryMock,
            upsert: upsertMock,
            get: vi.fn()
        });
        upsertMock.mockResolvedValueOnce(undefined);

        const store = new MemoryChromaDBStore({
            hasToRemember: "Remember user preferences",
            session: "  session-a  "
        });

        const saved = await store.saveMemory({
            id: "memory-3",
            title: "Saved memory",
            content: "Persisted content",
            keywords: ["alpha"],
            subMemoryIds: []
        });

        expect(saved).toBe(true);
        expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
            ids: ["memory-3"],
            documents: [expect.any(String)],
            metadatas: [expect.objectContaining({
                session: "session-a"
            })]
        }));
    });
});

describe("Memory duplicate detection", () => {
    it("treats array fetch results as duplicate candidates", async () => {
        const existingRecord: MemoryRecord = {
            id: "memory-1",
            title: "Normalized Title",
            content: "Shared content",
            keywords: ["alpha", "beta"],
            subMemoryIds: []
        };

        const store = {
            config: {
                hasToRemember: "Remember user preferences",
                session: "session-a"
            },
            fetchMemory: vi.fn().mockResolvedValueOnce([
                existingRecord,
                {
                    id: "memory-2",
                    title: "Other title",
                    content: "Other content",
                    keywords: ["gamma"],
                    subMemoryIds: []
                }
            ]),
            saveMemory: vi.fn()
        } satisfies SchemaMemoryStore;

        const memory = new Memory(store);
        const duplicate = await (memory as unknown as {
            findDuplicateRecord: (record: MemoryRecord, words?: string | string[]) => Promise<MemoryRecord | undefined>;
        }).findDuplicateRecord(
            {
                id: "memory-99",
                title: "Normalized Title",
                content: "Shared content",
                keywords: ["beta", "delta"],
                subMemoryIds: []
            },
            ["Normalized", "Title"]
        );

        expect(duplicate).toStrictEqual(existingRecord);
    });
});