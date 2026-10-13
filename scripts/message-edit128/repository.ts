export * from "../../src/chat/repository";
import { createChatRepository as original } from "../../src/chat/repository";
export const databaseName = "MessageEdit128Synthetic";
export function createChatRepository() { return original(databaseName); }
