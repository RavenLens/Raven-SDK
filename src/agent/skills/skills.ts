// TODO: Develop Skills Shape and stores like localPersistant, localTemporary, Redis, MongoDB
// TODO: Develop cascade skills
import z from "zod";
import { tool, Tool } from "../tools/tools";
import { SchemaSkillStore, SkillFileEntryWithContent } from "./stores/schema";

export interface SkillSharedConfig {
    /**
     * Derives default value from the of base [`Skills`](../skills.ts) class
     * Manual configuration will be overrided by builtin logic
    */
    dynamicSkillCreation?: boolean;
    /**
     * Allow to dynamically remove the skill(s)
     * Default: `false`
     */
    dynamicSkillRemoval?: boolean;
    /**
     * Skill relocation
     * Default: `false`
    */
    dynamicSkillRelocation?: boolean;
    /** 
     * Optional: Session is required to store the skills bound e.g: to user account or specific user session
     * Some stores requires it some other don't
    */
    session?: string;
}

export interface SkillConfig<SkillStorage extends SchemaSkillStore> extends SkillSharedConfig {
    skillStorage: SkillStorage;
}

interface SkillsFoundation<SkillStorage extends SchemaSkillStore> {
    config: SkillConfig<SkillStorage>;
    createExploreSkillsAgentTools(): Tool<any, any>[];
    createExploreSkillsAgentTools(): Tool<any, any>[];
    api: SkillConfig<SkillStorage>["skillStorage"]
}

export class Skills<SkillStorage extends SchemaSkillStore> implements SkillsFoundation<SkillStorage> {
    config: SkillConfig<SkillStorage>;
    static exploreSkillsPrompt: string = [
        "Your mission is to discover, inspect, and explain skills in a format compatible with the Open Skills standard: https://agentskills.io/home.",
        "Use only the provided explore tools and follow their argument schemas exactly.",
        "",
        "Available explore tools:",
        "1) skill_folder_discover",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: list direct child entries from a location. Returns JSON text of entries with folder/file types and relative locations.",
        "2) skill_meta_read",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: read only SKILL.md frontmatter metadata for a skill folder/file path.",
        "3) skill_full_read",
        "   - Arguments: { fromLocation?: string }",
        "   - Purpose: read full file content of `Skill.md`, script, assets, documentation and more of the skill folder. Read the Skill.md first if you're not instruct to do differently -> do this to understand the skill functionality and structure.",
        "",
        "Exploration workflow:",
        "- First call skill_folder_discover to map wards, skills, and support folders.",
        "- For candidate skills, call skill_meta_read first for fast routing.",
        "- Call skill_full_read only when full instructions are needed.",
        "- Treat empty responses as not-found or missing SKILL.md and continue discovery instead of guessing.",
        "",
        "Open Skills alignment rules:",
        "- The canonical skill definition should be in SKILL.md.",
        "- Prefer structure: <skill>/SKILL.md with optional scripts, references, assets.",
        "- Keep interpretations grounded in file content; do not invent metadata or capabilities.",
        "",
        "Output policy:",
        "- Summarize discovered skill hierarchy and capabilities.",
        "- Explicitly mention uncertainty when metadata/full content is unavailable.",
        "- Never claim a skill exists without evidence from discover/read tools."
    ].join("\n");
    static createSkillsPrompt: string = [
        "You are RavenADK Skills Curator.",
        "Your mission is to create, organize, relocate, and remove skills in RavenADK while keeping Open Skills compatibility: https://agentskills.io/home.",
        "Use only the provided management/exploration tools and respect each tool schema exactly.",
        "",
        "Creation and management tools:",
        "1) skill_folder_create",
        "   - Arguments: { folderName: string, folderLocation?: string }",
        "   - Creates a new skill ward/folder under folderLocation or root if omitted.",
        "2) skill_file_create",
        "   - Arguments: { skillFile: { fileName: string, type: skill|script|reference|documentation|assets, location: string, content: string }, inLocation?: string }",
        "   - Creates a file entry with content.",
        "3) skill_folder_remove",
        "   - Arguments: { folderLocation: string }",
        "   - Recursively removes a ward/folder subtree.",
        "4) skill_remove",
        "   - Arguments: { skillLocation: string }",
        "   - Recursively removes a skill folder subtree.",
        "5) skill_relocate",
        "   - Arguments: { fromLocation: string, toLocation: string }",
        "   - Relocates a skill or ward under target location.",
        "",
        "Exploration helpers available in the same runtime:",
        "- skill_folder_discover, skill_meta_read, skill_full_read.",
        "Use these to verify results after each mutation.",
        "",
        "RavenADK and Open Skills creation policy:",
        "- For a new skill, create a skill folder first, then create SKILL.md as the canonical skill file.",
        "- Use skill_file_create with type=skill and fileName=SKILL.md for the core skill definition.",
        "- Keep supporting files in scripts/references/assets with matching type values.",
        "- Ensure metadata/frontmatter in SKILL.md is valid and informative for routing.",
        "",
        "Safe mutation workflow:",
        "- Discover target location before any write/remove/relocate call.",
        "- After each mutation, validate by re-discovering and reading metadata/full skill as needed.",
        "- Do not perform destructive removal when target path is ambiguous.",
        "",
        "Execution policy:",
        "- Tool availability depends on runtime flags (dynamic creation/removal/relocation).",
        "- If a required tool is unavailable or returns false, report limitation and do not fabricate success.",
        "- Prefer minimal, reversible changes and keep skill structure coherent."
    ].join("\n");
    
    constructor(config: SkillConfig<SkillStorage>) {
        this.config = config;
    }
    
    /** 
     * Create set of tools to read skills
     * Supportive for using the skills
    */
    createExploreSkillsAgentTools() {
        const { readSkillFull, readSkillMeta, discoverSkillFolder } = this.config.skillStorage;
        const toolsSet: Tool<any, any>[] = [];

        type DiscoverSkillFolderParams = Parameters<SchemaSkillStore["discoverSkillFolder"]>;
        type DiscoverSkillFolderArgs = { fromLocation?: DiscoverSkillFolderParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const discoveredEntriesResult = await discoverSkillFolder(fromLocation);
                    return JSON.stringify(discoveredEntriesResult, null, 2);
                },
                {
                    toolName: "skill_folder_discover",
                    toolDescription: "Use to discover skill wards/subwards and skill-related files in a location.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location where skills should be discovered. If omitted, root skill location is used.")
                    } satisfies Record<keyof DiscoverSkillFolderArgs, any>)
                }
            )
        );

        type ReadSkillMetaParams = Parameters<SchemaSkillStore["readSkillMeta"]>;
        type ReadSkillMetaArgs = { fromLocation?: ReadSkillMetaParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const skillMetaResult = await readSkillMeta(fromLocation);
                    return String(skillMetaResult);
                },
                {
                    toolName: "skill_meta_read",
                    toolDescription: "Use to read only frontmatter metadata from SKILL.md.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location of skill folder or SKILL.md file. If omitted, root is used.")
                    } satisfies Record<keyof ReadSkillMetaArgs, any>)
                }
            )
        );

        type ReadSkillFullParams = Parameters<SchemaSkillStore["readSkillFull"]>;
        type ReadSkillFullArgs = { fromLocation?: ReadSkillFullParams[0] };

        toolsSet.push(
            tool(
                async ({ fromLocation }) => {
                    const skillFullResult = await readSkillFull(fromLocation);
                    return String(skillFullResult);
                },
                {
                    toolName: "skill_full_read",
                    toolDescription: "Use to read full SKILL.md content with metadata and instructions.",
                    toolArguments: z.object({
                        fromLocation: z.string().optional().describe("Location of skill folder or SKILL.md file. If omitted, root is used.")
                    } satisfies Record<keyof ReadSkillFullArgs, any>)
                }
            )
        );

        return toolsSet;
    }

    /** 
     * Create set of tools to make, manage skills
     * Supportive for creating/removing skills
    */
    createManageSkillAgentTools() {
        const { createSkillFile, createSkillFolder, reloacateSkill, removeSkill, removeSkillFolder } = this.config.skillStorage;
        const toolsSet: Tool<any, any>[] = [];

        if (this.config.dynamicSkillCreation) {
            // Folder
            type CreateSkillFolderParams = Parameters<SchemaSkillStore['createSkillFolder']>
            type CreateSkillFolderArgs = { folderName: CreateSkillFolderParams[0]; folderLocation: CreateSkillFolderParams[1] };

            toolsSet.push(
                tool(
                    async ({ folderName, folderLocation }) => {
                        const createFolderSkillsResult = await createSkillFolder(folderName, folderLocation);
    
                        return String(createFolderSkillsResult);
                    },
                    {
                        toolName: "skill_folder_create",
                        toolDescription: `Use to create skill folder where skills will be then placed. Skill folder is otherwise skill ward where then skills and subskills will be allocated`,
                        toolArguments: z.object({
                            folderName: z.string().describe("Name for folder where will be skills allocated"),
                            folderLocation: z.string().optional().describe("Location where folder has to be spawned. If not specified will be spawn in the root skills directory - use such condition to spawn the main skill wards")
                        } satisfies Record<keyof CreateSkillFolderArgs, any>)
                    }
                )
            );

            // File
            type CreateSkillParams = Parameters<SchemaSkillStore['createSkillFile']>
            type CreateSkillArgs = { skillFile: CreateSkillParams[0]; inLocation?: CreateSkillParams[1] };

            toolsSet.push(
                tool(
                    async ({ skillFile, inLocation }) => {
                        const createFolderSkillsResult = await createSkillFile(skillFile, inLocation);
    
                        return String(createFolderSkillsResult);
                    },
                    {
                        toolName: "skill_file_create",
                        toolDescription: `Use to create skill file that is acutally the skill or one of skill type. It can be used to make the skill, script, reference, documentation, assets file of skill in the existsing skill folder`,
                        toolArguments: z.object({
                            skillFile: z.object({
                                fileName: z.string(),
                                type: z.enum(["skill", "script", "reference", "documentation", "assets"]),
                                location: z.string(),
                                content: z.string()
                            } satisfies Record<keyof SkillFileEntryWithContent, any>),
                            inLocation: z.string().optional().describe("Location where skill has to be spawned. If not specified will be spawn in the root skills directory - use such condition to spawn skills in root skills directory")
                        } satisfies Record<keyof CreateSkillArgs, any>)
                    }
                )
            );
        }

        if (this.config.dynamicSkillRemoval) {
            // Skill folder
            type RemoveSkillFolderParams = Parameters<SchemaSkillStore['removeSkillFolder']>
            type RemoveSkillFolderArgs = { folderLocation: RemoveSkillFolderParams[0] };

            toolsSet.push(
                tool(
                    async ({ folderLocation }) => {
                        const removeFolderSkillsResult = await removeSkillFolder(folderLocation);
    
                        return String(removeFolderSkillsResult);
                    },
                    {
                        toolName: "skill_folder_remove",
                        toolDescription: `Use to remove skill folders with subfolders and skills are in this folder. Removes skill folder with subfolders and skills in this folder and subfolders. To avoid such behaviour relocate skills first to unaffected directories`,
                        toolArguments: z.object({
                            folderLocation: z.string().describe("Location where actually skill folder is"),
                        } satisfies Record<keyof RemoveSkillFolderArgs, any>)
                    }
                )
            );
            
            // Skill
            type RemoveSkillParams = Parameters<SchemaSkillStore['removeSkill']>
            type RemoveSkillArgs = { skillLocation: RemoveSkillParams[0] };

            toolsSet.push(
                tool(
                    async ({ skillLocation }) => {
                        const removeSkillResult = await removeSkill(skillLocation);
    
                        return String(removeSkillResult);
                    },
                    {
                        toolName: "skill_remove",
                        toolDescription: `Use to remove particular skill`,
                        toolArguments: z.object({
                            skillLocation: z.string().describe("Location where actually skill is / skill folder is"),
                        } satisfies Record<keyof RemoveSkillArgs, any>)
                    }
                )
            );
        }

        if (this.config.dynamicSkillRelocation) {
            type ReloParams = Parameters<SchemaSkillStore['reloacateSkill']>; // [string, string]
            type ReloArgs = { fromLocation: ReloParams[0]; toLocation: ReloParams[1] };

            toolsSet.push(
                tool(
                    async ({ fromLocation, toLocation }) => {
                        const relocateResult = await reloacateSkill(fromLocation, toLocation);
    
                        return String(relocateResult);
                    },
                    {
                        toolName: "skill_relocate",
                        toolDescription: `Use to rellocate particular skills, skill wards (sets of skills = folders with multiple similar skills) and/or subwards (separate set of skills)`,
                        toolArguments: z.object({
                            fromLocation: z.string().describe("Location where actually skill is / skill folder is"),
                            toLocation: z.string().describe("Location where skill has to be put")
                        } satisfies Record<keyof ReloArgs, any>)
                    }
                )
            );
        }

        return toolsSet;
    }
    
    get api() {
        return this.config.skillStorage;
    }
}
