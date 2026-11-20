// yarn definition: writes src/definition.json, the tool definition the plugin hands to GUI Chat
// hosts, generated from the library's manageAvatarScript input schema (one source of truth). It
// is a JSON file so the browser entry can use it without loading the library.
import { writeFile } from "node:fs/promises";
import { definitionText } from "./definition.ts";

await writeFile(new URL("../src/definition.json", import.meta.url), definitionText());
console.log("wrote src/definition.json");
