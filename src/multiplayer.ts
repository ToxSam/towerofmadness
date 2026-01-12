/**
 * Tower of Madness - Multiplayer System (DCL Authoritative Server)
 *
 * Uses Decentraland's built-in authoritative server pattern.
 * State is synchronized via ECS components (schemas.ts).
 * Messages are sent via registerMessages() (messages.ts).
 */

import { engine, Transform, PlayerIdentityData, AvatarBase, VisibilityComponent, GltfContainer } from '@dcl/sdk/ecs'
import { room } from './shared/messages'
import {
  RoundStateComponent,
  LeaderboardComponent,
  WinnersComponent,
  TowerConfigComponent,
  ChunkComponent,
  RoundPhase,
  LeaderboardEntry,
  WinnerEntry,
  TowerConfig
} from './shared/schemas'
import { getServerTime, isTimeSyncReady, getTimeSyncOffset } from './shared/timeSync'

// Re-export types for compatibility
export type { LeaderboardEntry, WinnerEntry, TowerConfig }
export { RoundPhase }

// Re-export time sync functions
export { getServerTime, isTimeSyncReady, getTimeSyncOffset }

// Re-export isServer from DCL SDK
export { isServer } from '@dcl/sdk/network'

// ============================================
// CLIENT SETUP
// ============================================

// Callback for when any player finishes (includes server-authoritative time)
let onPlayerFinishedCallback: ((displayName: string, time: number, finishOrder: number) => void) | null = null

export function setupClient() {
  // Listen for player finished broadcasts
  room.onMessage('playerFinishedBroadcast', (data) => {
    console.log(`[Game] ${data.displayName} finished #${data.finishOrder} in ${data.time.toFixed(2)}s`)
    if (onPlayerFinishedCallback) {
      onPlayerFinishedCallback(data.displayName, data.time, data.finishOrder)
    }
  })
}

export function onPlayerFinished(callback: (displayName: string, time: number, finishOrder: number) => void) {
  onPlayerFinishedCallback = callback
}


// ============================================
// SEND MESSAGES TO SERVER
// ============================================

export function sendPlayerJoined() {
  room.send('playerJoin', {})
}

export function sendPlayerStarted() {
  room.send('playerStarted', {})
}

export function sendPlayerFinished() {
  room.send('playerFinished', { time: 0 }) // Time is calculated server-side
}

// ============================================
// LOCAL PLAYER DATA (from avatar entities)
// ============================================

export type LocalPlayerHeight = {
  address: string
  displayName: string
  height: number
}

export function getLocalPlayerHeights(excludeSelf: boolean = false): LocalPlayerHeight[] {
  const players: LocalPlayerHeight[] = []

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    // Skip current player if excludeSelf is true
    if (excludeSelf && entity === engine.PlayerEntity) continue

    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    const avatarBase = AvatarBase.getOrNull(entity)
    const displayName = avatarBase?.name || identity.address.substring(0, 8)

    players.push({
      address: identity.address,
      displayName: displayName,
      height: transform.position.y
    })
  }

  // Sort by height descending
  players.sort((a, b) => b.height - a.height)

  return players
}

// ============================================
// COMPONENT ACCESS HELPERS
// ============================================

export function getRoundState(): { phase: RoundPhase; remainingTime: number; speedMultiplier: number } | null {
  for (const [entity] of engine.getEntitiesWith(RoundStateComponent)) {
    const state = RoundStateComponent.get(entity)

    // Calculate remaining time locally using synchronized server time
    const serverNow = getServerTime()
    const elapsed = (serverNow - state.lastSpeedChangeTime) / 1000
    const adjustedElapsed = elapsed * state.speedMultiplier
    const remainingTime = Math.max(0, state.remainingAtSpeedChange - adjustedElapsed)

    return {
      phase: state.phase,
      remainingTime: remainingTime,
      speedMultiplier: state.speedMultiplier
    }
  }
  return null
}

export function getLeaderboard(): LeaderboardEntry[] {
  for (const [entity] of engine.getEntitiesWith(LeaderboardComponent)) {
    return LeaderboardComponent.get(entity).players as LeaderboardEntry[]
  }
  return []
}

export function getWinners(): WinnerEntry[] {
  for (const [entity] of engine.getEntitiesWith(WinnersComponent)) {
    return WinnersComponent.get(entity).winners as WinnerEntry[]
  }
  return []
}

// Get tower chunks directly from synced entities (sorted by Y position)
// ChunkComponent is an empty tag - chunkId is derived from GltfContainer.src
export function getTowerChunksFromEntities(): string[] {
  const chunks: { chunkId: string; y: number }[] = []

  // Find all visible entities with ChunkComponent tag
  for (const [entity] of engine.getEntitiesWith(ChunkComponent, Transform, VisibilityComponent, GltfContainer)) {
    const visibility = VisibilityComponent.get(entity)
    if (!visibility.visible) continue

    // Derive chunkId from GltfContainer.src (e.g., "assets/chunks/Chunk01.glb" -> "Chunk01")
    const gltf = GltfContainer.get(entity)
    const match = gltf.src.match(/assets\/chunks\/(\w+)\.glb/)
    if (!match) continue

    const transform = Transform.get(entity)
    chunks.push({ chunkId: match[1], y: transform.position.y })
  }

  // Sort by Y position (lowest first) and return chunk IDs
  chunks.sort((a, b) => a.y - b.y)

  // Add ChunkStart at the beginning (it's a static entity, not in the pool)
  return ['ChunkStart', ...chunks.map((c) => c.chunkId)]
}

export function getTowerConfig(): TowerConfig | null {
  for (const [entity] of engine.getEntitiesWith(TowerConfigComponent)) {
    const config = TowerConfigComponent.get(entity)

    // Get chunkIds from actual entities for accuracy
    const chunkIds = getTowerChunksFromEntities()

    return {
      chunkIds: chunkIds.length > 1 ? chunkIds : config.chunkIds as string[],
      chunkHeight: config.chunkHeight,
      totalHeight: config.totalHeight
    }
  }
  return null
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
