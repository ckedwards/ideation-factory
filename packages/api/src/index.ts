// @ideaf/api: every operation defined once, with a schema for its input and
// output. From each definition come the HTTP route (and its OpenAPI
// description), the MCP tool, and the typed client the web app and cli import.
//
// Step 3 of the build plan adds the registry and the first operations: create an
// idea, sync (with base hashes and "pull first"), pull, show blocks, edit (dry
// run and apply), and comments.

export type OperationName = never
