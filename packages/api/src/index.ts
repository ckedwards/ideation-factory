// @ideaf/api: every operation defined once, with a schema for its input and
// output. From each definition come the HTTP route (createRouter), its OpenAPI
// description (openApiDocument), its MCP tool (mcpTools), and its method on the
// typed client the web app and the cli import (createApiClient).

export { type ApiClient, type CallOptions, type ClientOptions, createApiClient } from './client.ts'
export { ApiError, ApiErrorBody, type ApiErrorCode, ERROR_STATUS, isApiErrorCode } from './errors.ts'
export { type McpTool, mcpTools } from './mcp.ts'
export { openApiDocument } from './openapi.ts'
export {
  API_PATH,
  ideaPath,
  defineOperation,
  type Input,
  type Method,
  type Operation,
  type Output,
  type ParsedInput,
} from './operation.ts'
export { ErrorDetails, type OperationKey, type Operations, operations } from './operations.ts'
export {
  type Context,
  createRouter,
  describeIssues,
  type HandlerResult,
  type Handlers,
  type RouterOptions,
  runOperation,
  type TokenScope,
} from './router.ts'
export { noticeText, type NoticeText } from './notices.ts'
export * as schemas from './schemas.ts'
export {
  type Caller,
  type IdeaStatus,
  type IdeaNotification,
  type InboxShow,
  type NoticeKind,
  type NoticeNotification,
  type Notification,
  type NotificationSettings,
  DRAFT_LIVE_CLOSE,
  DraftLiveClientMessage,
  DraftLiveEvent,
  LIVE_CLOSE,
  LiveClientMessage,
  LiveEvent,
  type Review,
  type Verdict,
  type WatchLevel,
} from './schemas.ts'
