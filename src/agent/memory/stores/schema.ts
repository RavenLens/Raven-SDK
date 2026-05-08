export interface SchemaMemoryConfig {
    /** 
     * Optional: Session is required to store the memory bound e.g: to user account or specific user session
     * Some stores requires it some other don't
    */
    session?: string;
}

export enum MemoryFetch {
    Sematic,
    Explore
}

export interface FetchBySemantic {
    by: MemoryFetch.Sematic;
    /** Use keywords like: content, title, keywords */
    words: string | string[];
}

export interface MemoryRecord {
    /** Is the unique id */
    id: string;
    title: string;
    /** The description and the merits of the knowledge titled with `title` */
    content: string;
    /** Keywords describe the memory */
    keywords: string[];
    /** 
     * Is the list with related subknowledge to these things
    */
    subMemoryIds: { 
        id: string;
        /** Assigned for edge to describe the connection strength. floating point number in range 0.00 - 1.00 with floating 64 bit double-precision (JavaScript compatible) */
        strength?: number;
    }[];
}

export type MemoryFetchResult = MemoryRecord | undefined;

export interface SchemaMemoryStore {
    config: SchemaMemoryConfig;

    /**
     * Fetches the memory from database
     * Use session as needed
    */
    fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): MemoryFetchResult | Promise<MemoryFetchResult>;
    /**
     * Save the records in the database
    */
    saveMemory(records: MemoryRecord): boolean | Promise<boolean>;
}
