// The gui-chat-protocol ToolDefinition for manageAvatarScript, built from the library's zod schema.
// Shared by the script that writes src/definition.json and the test that checks it is current.
import { TOOL_DESCRIPTION, TOOL_NAME, toolInputJsonSchema } from "../../src/tool.ts";

export function definitionText(): string {
  const schema = toolInputJsonSchema();
  const given = schema.properties;
  const properties: Record<string, unknown> = typeof given === "object" && given !== null ? Object.fromEntries(Object.entries(given)) : {};
  const definition = {
    type: "function",
    name: TOOL_NAME,
    description: `${TOOL_DESCRIPTION} The video is shown to the user in a player.`,
    parameters: { type: "object", properties, required: schema.required ?? ["action"] },
  };
  return `${JSON.stringify(definition, null, 2)}\n`;
}
