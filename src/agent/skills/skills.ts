// TODO: Develop Skills Shape and stores like localPersistant, localTemporary, Redis, MongoDB
// TODO: Develop cascade skills
import { SchemaSkillStore } from "./stores/schema";

export interface SkillConfig<SkillStorage extends SchemaSkillStore> {
    /**
     * Determines are going to be skills make dynamically along conversation agent learns about user and his tasks
    */
    dynamicSkillCreation: boolean;
    skillStorage: SkillStorage;
}

interface SkillsFoundation<SkillStorage extends SchemaSkillStore> {
    config: SkillConfig<SkillStorage>;
    api: SkillConfig<SkillStorage>["skillStorage"]
}

export class Skills<SkillStorage extends SchemaSkillStore> implements SkillsFoundation<SkillStorage> {
    config: SkillConfig<SkillStorage>;
    
    constructor(config: SkillConfig<SkillStorage>) {
        this.config = config;
    }
    
    get api() {
        return this.config.skillStorage;
    }
}
