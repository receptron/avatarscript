// The tool definition, from the generated JSON (see scripts/write-definition.ts). Both entries use
// it: the core to register the tool, the Vue entry to name it, without loading the library.
import type { ToolDefinition } from "gui-chat-protocol";
import definition from "./definition.json" with { type: "json" };

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: definition.name,
  description: definition.description,
  parameters: { type: "object", properties: definition.parameters.properties, required: definition.parameters.required },
};
