import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillMongoDBStore } from "../../src/agent/skills/stores/mongodbStore";
import { SkillDiskStore } from "../../src/agent/skills/stores/diskStore";

describe("SkillDiskStore.removeSkill", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "raven-adk-disk-store-"));

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("removes a skill folder recursively when removal is enabled", () => {
        const store = new SkillDiskStore({
            rootDir: tempRoot,
            session: "session-a",
            dynamicSkillRemoval: true
        });

        const skillRoot = path.join(tempRoot, "session-a", "alpha");
        fs.mkdirSync(path.join(skillRoot, "scripts"), { recursive: true });
        fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "---\nname: alpha\n---\n# alpha", "utf8");
        fs.writeFileSync(path.join(skillRoot, "scripts", "run.ts"), "export {}", "utf8");

        expect(store.removeSkill("alpha")).toBe(true);
        expect(fs.existsSync(skillRoot)).toBe(false);
    });

    it("refuses removal when the feature is disabled", () => {
        const store = new SkillDiskStore({
            rootDir: tempRoot,
            session: "session-b",
            dynamicSkillRemoval: false
        });

        const skillRoot = path.join(tempRoot, "session-b", "beta");
        fs.mkdirSync(skillRoot, { recursive: true });

        expect(store.removeSkill("beta")).toBe(false);
        expect(fs.existsSync(skillRoot)).toBe(true);
    });
});

describe("SkillDiskStore.createSkillFolder", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "raven-adk-disk-folder-"));

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("creates a folder inside the configured session root", () => {
        const store = new SkillDiskStore({
            rootDir: tempRoot,
            session: "session-c",
            dynamicSkillCreation: true
        });

        expect(store.createSkillFolder("ward-a")).toBe(true);
        expect(fs.existsSync(path.join(tempRoot, "session-c", "ward-a"))).toBe(true);
    });
});

describe("SkillDiskStore.removeSkillFolder", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "raven-adk-disk-folder-remove-"));

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("removes a folder subtree recursively when removal is enabled", () => {
        const store = new SkillDiskStore({
            rootDir: tempRoot,
            session: "session-d",
            dynamicSkillRemoval: true
        });

        const folderRoot = path.join(tempRoot, "session-d", "ward-b");
        fs.mkdirSync(path.join(folderRoot, "alpha", "scripts"), { recursive: true });
        fs.writeFileSync(path.join(folderRoot, "alpha", "SKILL.md"), "---\nname: alpha\n---\n# alpha", "utf8");

        expect(store.removeSkillFolder("ward-b")).toBe(true);
        expect(fs.existsSync(folderRoot)).toBe(false);
    });
});

describe("SkillMongoDBStore.removeSkill", () => {
    it("deletes a skill subtree when removal is enabled", async () => {
        const documents = [
            { kind: "folder", location: "skills/session-a/alpha", type: "skill", folderName: "alpha", parentLocation: "skills/session-a" },
            { kind: "file", location: "skills/session-a/alpha/SKILL.md", type: "skill", fileName: "SKILL.md", parentLocation: "skills/session-a/alpha", content: "---\nname: alpha\n---\n# alpha" },
            { kind: "file", location: "skills/session-a/alpha/scripts/run.ts", type: "script", fileName: "run.ts", parentLocation: "skills/session-a/alpha/scripts", content: "export {}" },
            { kind: "folder", location: "skills/session-a/beta", type: "skill", folderName: "beta", parentLocation: "skills/session-a" }
        ] as Array<Record<string, unknown>>;

        const collection = {
            find: () => ({
                toArray: async () => documents as never[]
            }),
            findOne: async () => null,
            insertOne: async () => ({ acknowledged: true }),
            updateOne: async () => ({ acknowledged: true }),
            deleteMany: async ({ location }: { location: RegExp }) => {
                const beforeCount = documents.length;

                for (let index = documents.length - 1; index >= 0; index -= 1) {
                    const documentLocation = String(documents[index].location ?? "");

                    if (location.test(documentLocation)) {
                        documents.splice(index, 1);
                    }
                }

                return { deletedCount: beforeCount - documents.length };
            }
        };

        const store = new SkillMongoDBStore({
            collection,
            root: "skills",
            session: "session-a",
            dynamicSkillRemoval: true
        });

        expect(await store.removeSkill("alpha")).toBe(true);
        expect(documents.map((document) => String(document.location))).toEqual([
            "skills/session-a/beta"
        ]);
    });

    it("refuses removal when the feature is disabled", async () => {
        let deleted = false;

        const collection = {
            find: () => ({
                toArray: async () => []
            }),
            findOne: async () => null,
            insertOne: async () => ({ acknowledged: true }),
            updateOne: async () => ({ acknowledged: true }),
            deleteMany: async () => {
                deleted = true;
                return { deletedCount: 1 };
            }
        };

        const store = new SkillMongoDBStore({
            collection,
            root: "skills",
            session: "session-b",
            dynamicSkillRemoval: false
        });

        expect(await store.removeSkill("beta")).toBe(false);
        expect(deleted).toBe(false);
    });
});

describe("SkillMongoDBStore.createSkillFolder", () => {
    it("creates a folder document when removal is enabled", async () => {
        const documents: Array<Record<string, unknown>> = [];

        const collection = {
            find: async () => documents,
            findOne: async (query: Record<string, unknown>) => documents.find((document) => document.location === query.location) ?? null,
            insertOne: async (document: Record<string, unknown>) => {
                documents.push(document);
                return { acknowledged: true };
            },
            updateOne: async () => ({ acknowledged: true })
        };

        const store = new SkillMongoDBStore({
            collection,
            root: "skills",
            session: "session-c",
            dynamicSkillCreation: true
        });

        expect(await store.createSkillFolder("ward-a")).toBe(true);
        expect(documents).toEqual([
            {
                kind: "folder",
                location: "skills/session-c/ward-a",
                type: "skill-ward",
                folderName: "ward-a",
                parentLocation: "skills/session-c"
            }
        ]);
    });
});

describe("SkillMongoDBStore.removeSkillFolder", () => {
    it("deletes a folder subtree when removal is enabled", async () => {
        const documents = [
            { kind: "folder", location: "skills/session-d/ward-b", type: "skill-ward", folderName: "ward-b", parentLocation: "skills/session-d" },
            { kind: "folder", location: "skills/session-d/ward-b/alpha", type: "skill", folderName: "alpha", parentLocation: "skills/session-d/ward-b" },
            { kind: "file", location: "skills/session-d/ward-b/alpha/SKILL.md", type: "skill", fileName: "SKILL.md", parentLocation: "skills/session-d/ward-b/alpha", content: "---\nname: alpha\n---\n# alpha" },
            { kind: "folder", location: "skills/session-d/gamma", type: "skill-ward", folderName: "gamma", parentLocation: "skills/session-d" }
        ] as Array<Record<string, unknown>>;

        const collection = {
            find: () => ({
                toArray: async () => documents as never[]
            }),
            findOne: async () => null,
            insertOne: async () => ({ acknowledged: true }),
            updateOne: async () => ({ acknowledged: true }),
            deleteMany: async ({ location }: { location: RegExp }) => {
                for (let index = documents.length - 1; index >= 0; index -= 1) {
                    const documentLocation = String(documents[index].location ?? "");

                    if (location.test(documentLocation)) {
                        documents.splice(index, 1);
                    }
                }

                return { deletedCount: 3 };
            }
        };

        const store = new SkillMongoDBStore({
            collection,
            root: "skills",
            session: "session-d",
            dynamicSkillRemoval: true
        });

        expect(await store.removeSkillFolder("ward-b")).toBe(true);
        expect(documents.map((document) => String(document.location))).toEqual([
            "skills/session-d/gamma"
        ]);
    });
});