/**
 * Agent threads and their messages (SPEC §20 phase 46).
 */
import type { Database } from "bun:sqlite";
import { ulid } from "../../lib/ulid.ts";
import type { AgentMessageDto, AgentThreadDto } from "../../../shared/types.ts";

export interface AgentThreadRow {
  id: number;
  ulid: string;
  title: string;
  connection_profile_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface AgentMessageRow {
  id: number;
  ulid: string;
  thread_id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  is_error: number;
  created_at: number;
}

export function toThreadDto(row: AgentThreadRow): AgentThreadDto {
  return {
    id: row.ulid,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAgentMessageDto(row: AgentMessageRow): AgentMessageDto {
  return {
    id: row.ulid,
    role: row.role,
    content: row.content,
    toolCalls:
      row.tool_calls === null
        ? []
        : (JSON.parse(row.tool_calls) as { name: string; arguments: string }[]).map((call) => ({
            name: call.name,
            arguments: call.arguments,
          })),
    isError: row.is_error === 1,
    createdAt: row.created_at,
  };
}

export function listThreads(db: Database): AgentThreadRow[] {
  return db.query("SELECT * FROM agent_threads ORDER BY updated_at DESC").all() as AgentThreadRow[];
}

export function findThread(db: Database, value: string): AgentThreadRow | null {
  return (db.query("SELECT * FROM agent_threads WHERE ulid = $v").get({ v: value }) ??
    null) as AgentThreadRow | null;
}

export function insertThread(db: Database, title: string): AgentThreadRow {
  const now = Date.now();
  return db
    .query(
      `INSERT INTO agent_threads (ulid, title, created_at, updated_at)
       VALUES ($ulid, $title, $now, $now) RETURNING *`,
    )
    .get({ ulid: ulid(), title, now }) as AgentThreadRow;
}

export function deleteThread(db: Database, id: number): void {
  db.query("DELETE FROM agent_threads WHERE id = $id").run({ id });
}

export function renameThread(db: Database, id: number, title: string): void {
  db.query("UPDATE agent_threads SET title = $title, updated_at = $now WHERE id = $id").run({
    id,
    title,
    now: Date.now(),
  });
}

export function threadMessages(db: Database, threadId: number): AgentMessageRow[] {
  return db
    .query("SELECT * FROM agent_messages WHERE thread_id = $t ORDER BY id")
    .all({ t: threadId }) as AgentMessageRow[];
}

export interface NewAgentMessage {
  threadId: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: string | null;
  toolCallId?: string | null;
  isError?: boolean;
}

export function appendAgentMessage(db: Database, input: NewAgentMessage): AgentMessageRow {
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO agent_messages
         (ulid, thread_id, role, content, tool_calls, tool_call_id, is_error, created_at)
       VALUES ($ulid, $thread, $role, $content, $calls, $callId, $isError, $now)
       RETURNING *`,
    )
    .get({
      ulid: ulid(),
      thread: input.threadId,
      role: input.role,
      content: input.content,
      calls: input.toolCalls ?? null,
      callId: input.toolCallId ?? null,
      isError: input.isError === true ? 1 : 0,
      now,
    }) as AgentMessageRow;

  db.query("UPDATE agent_threads SET updated_at = $now WHERE id = $id").run({
    id: input.threadId,
    now,
  });
  return row;
}
