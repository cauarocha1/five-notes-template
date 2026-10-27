const baseUrl = (process.env.FIVE_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const deviceId = crypto.randomUUID()
const noteId = crypto.randomUUID()
const boardId = crypto.randomUUID()
const stamp = () => new Date().toISOString()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function post(body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  assert(response.status === expectedStatus, `Esperava HTTP ${expectedStatus}; recebi ${response.status}.`)
  return response
}

async function sync(operations = [], cursor = 0) {
  return syncFrom(deviceId, operations, cursor)
}

async function syncFrom(sourceDeviceId, operations = [], cursor = 0) {
  const response = await post(JSON.stringify({ deviceId: sourceDeviceId, cursor, operations }))
  return response.json()
}

function operation({ opId = crypto.randomUUID(), baseRevision = null, title, deletedAt = null, sourceDeviceId = deviceId }) {
  const updatedAt = stamp()
  return {
    opId, deviceId: sourceDeviceId, entity: 'note', entityId: noteId, baseRevision,
    data: { id: noteId, folderId: null, title, body: 'Teste automático do protocolo de sincronização.', revision: baseRevision ?? 0, updatedAt, deletedAt },
    updatedAt,
  }
}

function boardOperation({ opId = crypto.randomUUID(), baseRevision = null, sceneJson, title = 'Quadro de teste', deletedAt = null, sourceDeviceId = deviceId }) {
  const updatedAt = stamp()
  return {
    opId, deviceId: sourceDeviceId, entity: 'board', entityId: boardId, baseRevision,
    data: { id: boardId, folderId: null, title, sceneJson, revision: baseRevision ?? 0, updatedAt, deletedAt },
    updatedAt,
  }
}

const health = await fetch(`${baseUrl}/api/health`)
assert(health.ok && (await health.json()).status === 'ok', 'A API de saúde não respondeu OK.')
await post('{', 400)

const create = operation({ title: 'Smoke test — criação' })
const created = await sync([create])
assert(created.acks.length === 1 && created.acks[0].revision === 1, 'A criação não retornou revisão 1.')

const retried = await sync([create], created.cursor)
assert(retried.acks.length === 1 && retried.acks[0].revision === 1, 'O reenvio idempotente não retornou o ACK original.')
assert(retried.conflicts.length === 0, 'O reenvio idempotente virou conflito.')

const otherDeviceId = crypto.randomUUID()
const competing = operation({ title: 'Edição em outro aparelho', sourceDeviceId: otherDeviceId })
const crossDeviceConflict = await syncFrom(otherDeviceId, [competing], created.cursor)
assert(crossDeviceConflict.conflicts.length === 1 && crossDeviceConflict.conflicts[0].remote?.revision === 1, 'O conflito entre aparelhos não foi detectado.')
assert(crossDeviceConflict.conflicts[0].remoteDeviceId === deviceId, 'A resposta não identificou o aparelho que gravou a revisão remota.')

const sameDeviceStale = operation({ title: 'Edição em outra aba' })
const sameDeviceRebase = await sync([sameDeviceStale], created.cursor)
assert(sameDeviceRebase.acks.length === 1 && sameDeviceRebase.acks[0].revision === 2, 'Uma revisão antiga do mesmo aparelho não foi rebaseada.')
assert(sameDeviceRebase.conflicts.length === 0, 'Uma corrida entre abas virou conflito recuperável.')

const update = operation({ baseRevision: 2, title: 'Smoke test — revisão 3' })
const updated = await sync([update], sameDeviceRebase.cursor)
assert(updated.acks.length === 1 && updated.acks[0].revision === 3, 'A atualização válida não retornou revisão 3.')

const deletedAt = stamp()
const deletion = operation({ baseRevision: 3, title: 'Smoke test — revisão 3', deletedAt })
const deleted = await sync([deletion], updated.cursor)
assert(deleted.acks.length === 1 && deleted.acks[0].revision === 4, 'A remoção lógica não retornou revisão 4.')

const changes = await sync([], updated.cursor)
assert(changes.changes.some((change) => change.entityId === noteId && change.revision === 4 && change.data?.deletedAt), 'O cursor não entregou o tombstone da nota.')

const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'five', elements: [{ id: 'shape', type: 'rectangle' }], appState: {}, files: {} })
const boardCreate = boardOperation({ sceneJson: scene, title: 'Arquitetura' })
const boardCreated = await sync([boardCreate], changes.cursor)
assert(boardCreated.acks.length === 1 && boardCreated.acks[0].revision === 1, 'A criação do quadro não retornou revisão 1.')
const boardPulled = await sync([], 0)
assert(boardPulled.changes.some((change) => change.entity === 'board' && change.entityId === boardId && change.data?.sceneJson === scene), 'O cursor não entregou o quadro serializado.')

const sameDeviceBoardRace = boardOperation({ sceneJson: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'same-device' }] }), title: 'Alterado em outra aba' })
const boardRebased = await sync([sameDeviceBoardRace], boardCreated.cursor)
assert(boardRebased.acks.length === 1 && boardRebased.acks[0].revision === 2 && boardRebased.conflicts.length === 0, 'A corrida entre abas do mesmo aparelho não foi rebaseada.')

const competingBoard = boardOperation({ baseRevision: 1, sceneJson: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'other-device' }] }), title: 'Outro aparelho', sourceDeviceId: otherDeviceId })
const boardConflict = await syncFrom(otherDeviceId, [competingBoard], boardCreated.cursor)
assert(boardConflict.conflicts.length === 1 && boardConflict.conflicts[0].remote?.revision === 2, 'O conflito de edição do quadro entre aparelhos não foi detectado.')
assert(boardConflict.conflicts[0].remoteDeviceId === deviceId, 'O conflito de quadro não identificou o aparelho remoto.')

const tooLarge = boardOperation({ sceneJson: 'x'.repeat(750_001) })
await post(JSON.stringify({ deviceId, cursor: boardRebased.cursor, operations: [tooLarge] }), 400)

const boardDeletion = boardOperation({ baseRevision: 2, sceneJson: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'same-device' }] }), title: 'Alterado em outra aba', deletedAt: stamp() })
const boardDeleted = await sync([boardDeletion], boardRebased.cursor)
assert(boardDeleted.acks.length === 1 && boardDeleted.acks[0].revision === 3, 'O tombstone do quadro não retornou revisão 3.')
const finalChanges = await sync([], boardRebased.cursor)
assert(finalChanges.changes.some((change) => change.entity === 'board' && change.entityId === boardId && change.revision === 3 && change.data?.deletedAt), 'O cursor não entregou o tombstone do quadro.')

console.log('OK: saúde, JSON inválido, notas, ACK idempotente, conflitos, rebase do mesmo aparelho, quadros, limite de tamanho, tombstones e cursor incremental.')
