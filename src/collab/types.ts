import type { ElementId } from "articulated";

// ---------------------------------------------------------------------------
// Wire protocol for MeetingWords realtime collaboration.
//
// Architecture: Matt Weidner's "text without CRDTs" semantic rebasing.
// Characters carry stable ElementIds. Clients send semantic mutations; the
// server (a Doc Durable Object) applies them literally in arrival
// order and rebroadcasts the applied ops. Clients maintain a confirmed mirror
// of server state, apply broadcast ops to it, and replay their own
// unacknowledged mutations on top (rollback/replay optimism).
// ---------------------------------------------------------------------------

export type ShareAccess = "none" | "view" | "comment" | "edit";

/** A semantic mutation, as authored by a client (or the agent edit API). */
export type ClientMutation = {
  name: "insert" | "delete";
  /** Monotonic per-client counter; the server acks the highest applied. */
  clientCounter: number;
  args: InsertArgs | DeleteArgs;
};

export type InsertArgs = {
  /** Insert after this id; null inserts at the start of the document. */
  before: ElementId | null;
  /** First id of the inserted run; chars get counters id.counter .. +length-1. */
  id: ElementId;
  content: string;
};

export type DeleteArgs = {
  /** Inclusive endpoints of the deleted run, by id. */
  startId: ElementId;
  endId: ElementId;
};

/**
 * A mutation as the server actually applied it — what gets broadcast.
 * Receivers apply these to their confirmed mirror in broadcast order,
 * which keeps every mirror byte-identical to the server.
 */
export type AppliedOp = {
  name: "insert" | "delete";
  args: InsertArgs | DeleteArgs;
};

/** Selection endpoints travel as articulated cursors (id left of the gap). */
export type SelectionState = {
  anchor: ElementId | null;
  head: ElementId | null;
};

// -- client -> server -------------------------------------------------------

export type ClientMutationMessage = {
  type: "mutation";
  clientId: string;
  mutations: ClientMutation[];
};

export type ClientPresenceMessage = {
  type: "presence";
  clientId: string;
  selection: SelectionState | null;
};

export type ClientMessage = ClientMutationMessage | ClientPresenceMessage;

// -- server -> client -------------------------------------------------------

/** Full state on connect (with clientId) or resync (without). */
export type ServerHelloMessage = {
  type: "hello";
  clientId?: string;
  docId: string;
  title: string;
  shareId: string;
  shareAccess: ShareAccess;
  text: string;
  idList: unknown; // SavedIdList
  serverCounter: number;
};

export type ServerMutationMessage = {
  type: "mutation";
  /** clientId of the author; "agent:<label>" for agent-API edits. */
  senderId: string;
  /** Highest clientCounter the server has applied for that sender. */
  senderCounter: number;
  serverCounter: number;
  ops: AppliedOp[];
};

/** Throttled full-state snapshot; heals any client drift. */
export type ServerCheckpointMessage = {
  type: "checkpoint";
  text: string;
  idList: unknown; // SavedIdList
  serverCounter: number;
};

export type ServerPresenceMessage = {
  type: "presence";
  clientId: string;
  name: string;
  color: string;
  kind: ParticipantKind;
  selection: SelectionState | null;
};

export type ServerPresenceLeaveMessage = {
  type: "presence-leave";
  clientId: string;
};

/** Live participant list — humans and agents, first-class both. */
export type ServerRosterMessage = {
  type: "roster";
  participants: Array<{ clientId: string; name: string; color: string; kind: ParticipantKind }>;
};

export type ServerThreadsMessage = {
  type: "threads-updated";
  docId: string;
};

export type ServerDocUpdatedMessage = {
  type: "updated";
  docId: string;
  updatedAt: string;
};

export type ParticipantKind = "owner" | "guest" | "agent";

export type ServerMessage =
  | ServerHelloMessage
  | ServerMutationMessage
  | ServerCheckpointMessage
  | ServerPresenceMessage
  | ServerPresenceLeaveMessage
  | ServerRosterMessage
  | ServerThreadsMessage
  | ServerDocUpdatedMessage;

// -- comments ---------------------------------------------------------------

export type CommentAnchor = {
  /** The quoted text plus short context, for re-anchoring after edits. */
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};

export type CommentMessage = {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type CommentThread = {
  id: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  anchor: CommentAnchor;
  messages: CommentMessage[];
};
