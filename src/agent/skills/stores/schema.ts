export interface SkillFileEntry {
    fileName: string;
    type: "skill" | "script" | "reference" | "documentation" | "assets";
    /** Location that guides to current file entry. It's the name and extension of the file */
    location: string;
}

export interface SkillFileEntryWithContent extends SkillFileEntry {
    /** It's the content of the file entry compilant with the [open skills standard](https://agentskills.io/skill-creation/evaluating-skills) */
    content: string;
}

export interface SkillFolderEntry {
    /**
     * skill-ward - is folder groups together multiple skills or sub skill-wards
     * skill - is the folder with skill
     */
    type: "skill-ward" | "skill" | "scripts" | "references" | "assets";
    /**
     * For type === "skill" | "skill-ward" the name is the skill name or the skill ward/subward respectivelly
     */
    folderName?: string;
    /** Location that guides to current folder. Can have subwards of skill */
    location: string;
}

// Include schema(s) for skill storages
export interface SchemaSkillStore {
    config: {
        /** 
         * Optional: Session is required to store the skills bound e.g: to user account or specific user session
         * Some stores requires it some other don't
        */
        session?: string;
        /**
         * Derives default value from the of base [`Skills`](../skills.ts) class
         * Manual configuration will be overrided by builtin logic
        */
        dynamicSkillCreation?: boolean;
    };
    
    /** 
     * Use it to discrover the skill wards/subwards, skills
     * @param fromLocation - is the skills location, used to explore the subwards of the specific skills, if not specified the default dir will be read. `config.session` always goes first before a `root` / `fromLocation`
     * @returns folders - when was read the file / subfile, files - when was read the skill
    */
    discoverSkillFolder(fromLocation?: string): (SkillFolderEntry | SkillFileEntry)[] | Promise<(SkillFolderEntry | SkillFileEntry)[]>;
    /** 
     * Read only the meta section of the skill and return it -> this is for faster read and processing
     * Read only from `SKILL.md` file
     * @param fromLocation if not specified the location will be the root one. `config.session` always goes first before a `root` / `fromLocation`
    */
    readSkillMeta(fromLocation?: string): string | Promise<string>;
    /** 
     * Return full file of skill with meta section attached
     * @param fromLocation if not specified the location will be the root one. `config.session` always goes first before a `root` / `fromLocation`
    */
    readSkillFull(fromLocation?: string): string | Promise<string>;
    /**
     * Usecase: Use to make the `"skill" | "script" | "reference" | "documentation" | "assets"`
     * Behaviour
     * * Runtime: Create skill only when `SchemaSkillStore["config"]["dynamicSkillCreation"] === true otherwise it won't work in runtime
     * * Manual: Use manually to make the new skill in the specified store
    */
    createSkillFile(
        skillFile: SkillFileEntryWithContent,
        inLocation?: string | undefined | null,
    ): boolean | Promise<boolean>;
    /**
     * Use to rellocate particular skills, wards and/or subwards
     * @param fromLocation - folder where is the skill / ward with skills and/or subwards
     * @param toLocation - folder where the `fromLocation` has to be relocated
     */
    reloacateSkill(
        fromLocation: string,
        toLocation: string
    ): boolean | Promise<boolean>
}
