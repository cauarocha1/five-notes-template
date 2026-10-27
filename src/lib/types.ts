export type EntityKind = 'folder' | 'note' | 'board'
export interface FileMove {
  entity: 'note' | 'board'
  entityId: string
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  revision: number
  updatedAt: string
  deletedAt: string | null
}

export interface Note {
  id: string
  folderId: string | null
  title: string
  body: string
  revision: number
  updatedAt: string
  deletedAt: string | null
}

export interface Board {
  id: string
  folderId: string | null
  title: string
  sceneJson: string
  revision: number
  updatedAt: string
  deletedAt: string | null
}

export interface OutboxOperation {
  opId: string
  deviceId: string
  entity: EntityKind
  entityId: string
  baseRevision: number | null
  data: Folder | Note | Board
  updatedAt: string
}

export interface RemoteChange {
  sequence: number
  entity: EntityKind
  entityId: string
  revision: number
  data: Folder | Note | Board | null
  deviceId?: string | null
}

export interface SyncAck {
  opId: string
  entity: EntityKind
  entityId: string
  revision: number
}

export interface SyncConflict {
  operation: OutboxOperation
  remote: Folder | Note | Board | null
  remoteDeviceId?: string | null
}

export interface SyncResponse {
  acks: SyncAck[]
  conflicts: SyncConflict[]
  changes: RemoteChange[]
  cursor: number
  hasMore: boolean
}

export type SyncStatus = 'checking' | 'synced' | 'pending' | 'offline' | 'local' | 'unavailable' | 'access-expired'

export const SEED_FOLDER_IDS = {
  inbox: 'five-folder-inbox-v1',
  study: 'five-folder-study-v1',
  course: 'five-folder-course-v1',
  software: 'five-folder-software-v1',
  projects: 'five-folder-projects-v1',
  personal: 'five-folder-personal-v1',
} as const

export const SEED_NOTE_ID = 'five-note-welcome-v1'
