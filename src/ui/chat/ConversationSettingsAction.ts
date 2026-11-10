import { createContext } from "react";

export const ConversationSettingsAction = createContext<{ open(): void; disabled: boolean } | undefined>(undefined);
