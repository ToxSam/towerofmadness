import {} from '@dcl/sdk/math'
import { engine, Transform, TriggerArea, triggerAreaEventsSystem, ColliderLayer, PointerEvents, PointerEventType, InputAction, pointerEventsSystem, AudioSource, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { EntityNames } from '../assets/scene/entity-names'
import { setupUi } from './ui'
import { generateTower } from './towerGenerator'

// Shared state for player height
export let playerHeight = 0

// Game state
export enum GameState {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  ENDED = 'ENDED'
}

export let gameState: GameState = GameState.NOT_STARTED
export let gameTimer: number = 0 // Time in seconds
export let gameStartTime: number = 0 // Timestamp when game started
export let currentGameHeight: number = 0 // Max height reached in current game
export let bestTime: number = 0 // Best time achieved
export let bestHeight: number = 0 // Best height achieved
export let gameResult: 'WIN' | 'DEATH' | null = null // Result of the last game
export let resultMessage: string = '' // Message to display
export let resultTimestamp: number = 0 // When the result was shown (for auto-hide)

/**
 * Helper function to get world position of an entity (accounting for parent transforms)
 * In SDK7, Transform.position for children is in local space relative to parent
 */
function getWorldPosition(entity: Entity): Vector3 {
  if (!Transform.has(entity)) return Vector3.Zero()
  
  const transform = Transform.get(entity)
  let localPos = transform.position
  
  // If entity has a parent, transform local position to world space
  if (transform.parent !== undefined && transform.parent !== engine.RootEntity && Transform.has(transform.parent)) {
    const parentTransform = Transform.get(transform.parent)
    const parentRot = parentTransform.rotation
    const parentScale = parentTransform.scale
    
    // Rotate the local position by parent rotation
    const rotatedPos = Vector3.rotate(localPos, parentRot)
    
    // Scale the rotated position
    const scaledPos = Vector3.create(
      rotatedPos.x * parentScale.x,
      rotatedPos.y * parentScale.y,
      rotatedPos.z * parentScale.z
    )
    
    // Get parent's world position and add the transformed local position
    const parentWorldPos = getWorldPosition(transform.parent)
    return Vector3.add(scaledPos, parentWorldPos)
  }
  
  // No parent, position is already in world space
  return localPos
}

// System to track player height
function trackPlayerHeight() {
  if (!Transform.has(engine.PlayerEntity)) return
  
  const playerTransform = Transform.get(engine.PlayerEntity)
  playerHeight = playerTransform.position.y
  
  // Track max height during active game
  if (gameState === GameState.IN_PROGRESS) {
    if (playerHeight > currentGameHeight) {
      currentGameHeight = playerHeight
    }
  }
}

// System to update game timer
function updateGameTimer() {
  if (gameState === GameState.IN_PROGRESS) {
    const currentTime = Date.now()
    gameTimer = (currentTime - gameStartTime) / 1000 // Convert to seconds
  }
}

// Function to start the game
function startGame() {
  console.log('[DEBUG] startGame() called')
  console.log('[DEBUG] Current gameState:', gameState)
  console.log('[DEBUG] Current playerHeight:', playerHeight)
  
  // Allow restarting if game has ended, but don't restart if already in progress
  if (gameState === GameState.IN_PROGRESS) {
    console.log('[DEBUG] Game already in progress, ignoring start request')
    return // Already in progress
  }
  
  console.log('[DEBUG] Starting game...')
  gameState = GameState.IN_PROGRESS
  gameStartTime = Date.now()
  gameTimer = 0
  currentGameHeight = playerHeight
  gameResult = null
  resultMessage = 'Game Started!'
  console.log('[DEBUG] Game started! State:', gameState, 'StartTime:', gameStartTime, 'Height:', currentGameHeight)
}

// Function to end game with WIN
function endGameWin() {
  if (gameState !== GameState.IN_PROGRESS) return
  
  gameState = GameState.ENDED
  gameResult = 'WIN'
  resultMessage = 'WIN!'
  resultTimestamp = Date.now() // Record when result was shown
  
  // Update best scores
  if (gameTimer > bestTime || bestTime === 0) {
    bestTime = gameTimer
  }
  if (currentGameHeight > bestHeight || bestHeight === 0) {
    bestHeight = currentGameHeight
  }
  
  console.log(`Game won! Time: ${gameTimer.toFixed(2)}s, Height: ${currentGameHeight.toFixed(2)}m`)
}

// Function to end game with DEATH
function endGameDeath() {
  if (gameState !== GameState.IN_PROGRESS) return
  
  gameState = GameState.ENDED
  gameResult = 'DEATH'
  resultMessage = 'DEATH - Go to TriggerStart to restart'
  resultTimestamp = Date.now() // Record when result was shown
  
  // Update best scores even on death
  if (gameTimer > bestTime || bestTime === 0) {
    bestTime = gameTimer
  }
  if (currentGameHeight > bestHeight || bestHeight === 0) {
    bestHeight = currentGameHeight
  }
  
  console.log(`Game ended! Time: ${gameTimer.toFixed(2)}s, Height: ${currentGameHeight.toFixed(2)}m`)
}

export function main() {
  console.log('[DEBUG] ========== main() called ==========')
  console.log('[DEBUG] EntityNames:', EntityNames)
  
  // Skybox time is set in scene.json to always be midday (43200 seconds = 12 hours = noon)
  // This ensures the sunlight is always up
  
  // Check player entity
  console.log('[DEBUG] PlayerEntity exists:', Transform.has(engine.PlayerEntity))
  if (Transform.has(engine.PlayerEntity)) {
    const playerPos = Transform.get(engine.PlayerEntity).position
    console.log('[DEBUG] Player position:', playerPos.x, playerPos.y, playerPos.z)
  }
  
  // Get trigger entities
  console.log('[DEBUG] Looking for trigger entities...')
  const triggerStart = engine.getEntityOrNullByName(EntityNames.TriggerStart)
  const triggerEnd = engine.getEntityOrNullByName(EntityNames.TriggerEnd)
  const triggerDeath = engine.getEntityOrNullByName(EntityNames.TriggerDeath)
  
  console.log('[DEBUG] TriggerStart entity:', triggerStart ? `Found (ID: ${triggerStart})` : 'NOT FOUND')
  console.log('[DEBUG] TriggerEnd entity:', triggerEnd ? `Found (ID: ${triggerEnd})` : 'NOT FOUND')
  console.log('[DEBUG] TriggerDeath entity:', triggerDeath ? `Found (ID: ${triggerDeath})` : 'NOT FOUND')
  
  // Set up TriggerStart - ensure it has a trigger area and listen for player entry
  if (triggerStart) {
    console.log('[DEBUG] Setting up TriggerStart (ID:', triggerStart, ')')
    
    // Check if it has transform
    if (Transform.has(triggerStart)) {
      const transform = Transform.get(triggerStart)
      console.log('[DEBUG] TriggerStart transform - Position:', transform.position.x, transform.position.y, transform.position.z)
      console.log('[DEBUG] TriggerStart transform - Scale:', transform.scale.x, transform.scale.y, transform.scale.z)
      
      const mutableTransform = Transform.getMutable(triggerStart)
      // If scale is too small, make it bigger
      if (transform.scale.x < 2 || transform.scale.y < 2 || transform.scale.z < 2) {
        console.log('[DEBUG] TriggerStart scale too small, increasing...')
        mutableTransform.scale = Vector3.create(
          Math.max(transform.scale.x, 2),
          Math.max(transform.scale.y, 2),
          Math.max(transform.scale.z, 2)
        )
        console.log('[DEBUG] TriggerStart new scale:', mutableTransform.scale.x, mutableTransform.scale.y, mutableTransform.scale.z)
      }
    } else {
      console.log('[DEBUG] TriggerStart has no transform, creating one...')
      Transform.create(triggerStart, {
        position: Vector3.create(0, 0, 0),
        scale: Vector3.create(4, 4, 4)
      })
    }
    
    // Add or replace trigger area to ensure it works
    console.log('[DEBUG] Adding TriggerArea to TriggerStart...')
    TriggerArea.setBox(triggerStart, ColliderLayer.CL_PLAYER)
    console.log('[DEBUG] TriggerArea added. Has TriggerArea:', TriggerArea.has(triggerStart))
    
    console.log('[DEBUG] Setting up onTriggerEnter listener for TriggerStart...')
    triggerAreaEventsSystem.onTriggerEnter(triggerStart, (e) => {
      console.log('[DEBUG] ========== TriggerStart ENTERED! ==========')
      console.log('[DEBUG] Event data:', JSON.stringify(e, null, 2))
      console.log('[DEBUG] Trigger entity:', e.triggeredEntity)
      console.log('[DEBUG] Trigger entity (from event):', e.trigger?.entity)
      startGame()
    })
    console.log('[DEBUG] onTriggerEnter listener registered for TriggerStart')
  } else {
    console.error('[DEBUG] TriggerStart entity not found!')
  }
  
  // Set up TriggerEnd
  if (triggerEnd) {
    console.log('[DEBUG] Setting up TriggerEnd (ID:', triggerEnd, ')')
    TriggerArea.setBox(triggerEnd, ColliderLayer.CL_PLAYER)
    
    if (Transform.has(triggerEnd)) {
      const transform = Transform.getMutable(triggerEnd)
      if (transform.scale.x < 2 || transform.scale.y < 2 || transform.scale.z < 2) {
        transform.scale = Vector3.create(
          Math.max(transform.scale.x, 2),
          Math.max(transform.scale.y, 2),
          Math.max(transform.scale.z, 2)
        )
      }
    } else {
      Transform.create(triggerEnd, {
        position: Vector3.create(0, 0, 0),
        scale: Vector3.create(4, 4, 4)
      })
    }
    
    triggerAreaEventsSystem.onTriggerEnter(triggerEnd, (e) => {
      console.log('[DEBUG] ========== TriggerEnd ENTERED! ==========')
      endGameWin()
    })
  } else {
    console.error('[DEBUG] TriggerEnd entity not found!')
  }
  
  // Set up TriggerDeath
  if (triggerDeath) {
    console.log('[DEBUG] Setting up TriggerDeath (ID:', triggerDeath, ')')
    TriggerArea.setBox(triggerDeath, ColliderLayer.CL_PLAYER)
    
    if (Transform.has(triggerDeath)) {
      const transform = Transform.getMutable(triggerDeath)
      if (transform.scale.x < 2 || transform.scale.y < 2 || transform.scale.z < 2) {
        transform.scale = Vector3.create(
          Math.max(transform.scale.x, 2),
          Math.max(transform.scale.y, 2),
          Math.max(transform.scale.z, 2)
        )
      }
    } else {
      Transform.create(triggerDeath, {
        position: Vector3.create(0, 0, 0),
        scale: Vector3.create(4, 4, 4)
      })
    }
    
    triggerAreaEventsSystem.onTriggerEnter(triggerDeath, (e) => {
      console.log('[DEBUG] ========== TriggerDeath ENTERED! ==========')
      endGameDeath()
    })
  } else {
    console.error('[DEBUG] TriggerDeath entity not found!')
  }
  
  // Manual trigger detection system (for asset-packs triggers)
  // Since SDK7 TriggerArea events don't work with asset-packs triggers, we check manually
  let triggerStartEntered = false
  let triggerEndEntered = false
  let triggerDeathEntered = false
  
  engine.addSystem(() => {
    if (!Transform.has(engine.PlayerEntity)) return
    
    const playerPos = Transform.get(engine.PlayerEntity).position
    
    // Check TriggerStart
    if (triggerStart && Transform.has(triggerStart)) {
      const triggerTransform = Transform.get(triggerStart)
      const triggerPos = triggerTransform.position
      const triggerScale = triggerTransform.scale
      
      // Check if player is within trigger bounds (box collision)
      const dx = Math.abs(playerPos.x - triggerPos.x)
      const dy = Math.abs(playerPos.y - triggerPos.y)
      const dz = Math.abs(playerPos.z - triggerPos.z)
      
      const halfWidth = triggerScale.x / 2
      const halfHeight = triggerScale.y / 2
      const halfDepth = triggerScale.z / 2
      
      const isInside = dx <= halfWidth && dy <= halfHeight && dz <= halfDepth
      
      if (isInside && !triggerStartEntered) {
        console.log('[DEBUG] ========== MANUAL TriggerStart DETECTED! ==========')
        console.log('[DEBUG] Player pos:', playerPos.x.toFixed(2), playerPos.y.toFixed(2), playerPos.z.toFixed(2))
        console.log('[DEBUG] Trigger pos:', triggerPos.x.toFixed(2), triggerPos.y.toFixed(2), triggerPos.z.toFixed(2))
        console.log('[DEBUG] Trigger scale:', triggerScale.x.toFixed(2), triggerScale.y.toFixed(2), triggerScale.z.toFixed(2))
        console.log('[DEBUG] Distance:', dx.toFixed(2), dy.toFixed(2), dz.toFixed(2))
        console.log('[DEBUG] Half size:', halfWidth.toFixed(2), halfHeight.toFixed(2), halfDepth.toFixed(2))
        triggerStartEntered = true
        startGame()
      } else if (!isInside && triggerStartEntered) {
        console.log('[DEBUG] Player left TriggerStart')
        triggerStartEntered = false
      }
    }
    
    // Check TriggerEnd
    if (triggerEnd && Transform.has(triggerEnd) && gameState === GameState.IN_PROGRESS) {
      const triggerTransform = Transform.get(triggerEnd)
      // Get world position (accounting for parent if TriggerEnd is a child of ChunkEnd01)
      const triggerPos = getWorldPosition(triggerEnd)
      const triggerScale = triggerTransform.scale
      
      const dx = Math.abs(playerPos.x - triggerPos.x)
      const dy = Math.abs(playerPos.y - triggerPos.y)
      const dz = Math.abs(playerPos.z - triggerPos.z)
      
      const halfWidth = triggerScale.x / 2
      const halfHeight = triggerScale.y / 2
      const halfDepth = triggerScale.z / 2
      
      const isInside = dx <= halfWidth && dy <= halfHeight && dz <= halfDepth
      
      if (isInside && !triggerEndEntered) {
        console.log('[DEBUG] ========== MANUAL TriggerEnd DETECTED! ==========')
        console.log('[DEBUG] Player pos:', playerPos.x.toFixed(2), playerPos.y.toFixed(2), playerPos.z.toFixed(2))
        console.log('[DEBUG] TriggerEnd world pos:', triggerPos.x.toFixed(2), triggerPos.y.toFixed(2), triggerPos.z.toFixed(2))
        console.log('[DEBUG] TriggerEnd local pos:', triggerTransform.position.x.toFixed(2), triggerTransform.position.y.toFixed(2), triggerTransform.position.z.toFixed(2))
        console.log('[DEBUG] TriggerEnd scale:', triggerScale.x.toFixed(2), triggerScale.y.toFixed(2), triggerScale.z.toFixed(2))
        console.log('[DEBUG] Distance:', dx.toFixed(2), dy.toFixed(2), dz.toFixed(2))
        triggerEndEntered = true
        endGameWin()
      } else if (!isInside && triggerEndEntered) {
        triggerEndEntered = false
      }
    }
    
    // Check TriggerDeath
    if (triggerDeath && Transform.has(triggerDeath) && gameState === GameState.IN_PROGRESS) {
      const triggerTransform = Transform.get(triggerDeath)
      const triggerPos = triggerTransform.position
      const triggerScale = triggerTransform.scale
      
      const dx = Math.abs(playerPos.x - triggerPos.x)
      const dy = Math.abs(playerPos.y - triggerPos.y)
      const dz = Math.abs(playerPos.z - triggerPos.z)
      
      const halfWidth = triggerScale.x / 2
      const halfHeight = triggerScale.y / 2
      const halfDepth = triggerScale.z / 2
      
      const isInside = dx <= halfWidth && dy <= halfHeight && dz <= halfDepth
      
      if (isInside && !triggerDeathEntered) {
        console.log('[DEBUG] ========== MANUAL TriggerDeath DETECTED! ==========')
        triggerDeathEntered = true
        endGameDeath()
      } else if (!isInside && triggerDeathEntered) {
        triggerDeathEntered = false
      }
    }
  })
  
  // Add debug system to periodically check state
  let lastDebugLog = 0
  engine.addSystem(() => {
    // Log game state every 5 seconds
    const now = Date.now()
    if (now - lastDebugLog > 5000) {
      console.log('[DEBUG] Game State Check - State:', gameState, 'Timer:', gameTimer.toFixed(2), 'Height:', playerHeight.toFixed(2))
      lastDebugLog = now
    }
  })
  
  // Add systems
  engine.addSystem(trackPlayerHeight)
  engine.addSystem(updateGameTimer)
  
  // Initialize UI
  setupUi()
  
  // Set up button panel for tower regeneration
  const buttonPanel = engine.getEntityOrNullByName(EntityNames.Button_Panel)
  if (buttonPanel) {
    console.log('[DEBUG] Setting up Button Panel for tower regeneration...')
    
    // Add pointer events to button panel (will work alongside asset-packs if present)
    // If pointer events already exist, onPointerDown will still register
    if (!PointerEvents.has(buttonPanel)) {
      PointerEvents.create(buttonPanel, {
        pointerEvents: [
          {
            eventType: PointerEventType.PET_DOWN,
            eventInfo: {
              button: InputAction.IA_POINTER,
              hoverText: 'Click to regenerate tower',
              showFeedback: true,
              maxDistance: 10
            }
          }
        ]
      })
    }
    
    // Listen for button clicks
    pointerEventsSystem.onPointerDown(
      {
        entity: buttonPanel,
        opts: {
          button: InputAction.IA_POINTER,
          hoverText: 'Click to regenerate tower',
          showFeedback: true,
          maxDistance: 10
        }
      },
      () => {
        console.log('[Tower Generator] Button clicked - regenerating tower...')
        generateTower()
      }
    )
    
    console.log('[DEBUG] Button Panel setup complete')
  } else {
    console.error('[DEBUG] Button Panel entity not found!')
  }
  
  // Generate initial tower on scene load
  console.log('[Tower Generator] Generating initial tower...')
  generateTower()
  
  // Setup background music - plays automatically when players enter
  setupBackgroundMusic('sounds/PixelSodaBar.mp3')
  
  console.log('[DEBUG] ========== main() setup complete ==========')
  console.log('[DEBUG] Initial gameState:', gameState)
}

// Store music entity globally so we can control it
let backgroundMusicEntity: Entity | null = null
let audioStarted = false

/**
 * Setup background music
 * Plays automatically when players enter the scene
 * SDK7 supports MP3, OGG, and WAV formats
 * 
 * Note: Some browsers block autoplay. Audio will start after first user interaction.
 */
function setupBackgroundMusic(audioPath: string) {
  // Create entity for background music
  backgroundMusicEntity = engine.addEntity()
  
  // Position audio at scene center for global sound
  // Audio will be audible throughout the scene
  Transform.create(backgroundMusicEntity, {
    position: Vector3.create(40, 0, 40), // Center of tower area
    scale: Vector3.One()
  })
  
  // Create audio source with looping enabled
  // SDK7 AudioSource supports: MP3, OGG, WAV formats
  AudioSource.create(backgroundMusicEntity, {
    audioClipUrl: audioPath,
    playing: true,   // Try to start playing immediately
    loop: true,      // Loop continuously
    volume: 1.0      // Volume level (0.0 to 1.0) - adjust as needed
  })
  
  console.log(`[Audio] Background music loaded: ${audioPath}`)
  console.log(`[Audio] Attempting to start playback...`)
  
  // System to ensure audio keeps playing (handles autoplay restrictions)
  engine.addSystem(() => {
    if (backgroundMusicEntity && AudioSource.has(backgroundMusicEntity)) {
      const audio = AudioSource.get(backgroundMusicEntity)
      
      // If audio stopped (due to autoplay restrictions), try to restart it
      if (!audio.playing && !audioStarted) {
        // Try to restart - this will work after user interaction
        const audioMutable = AudioSource.getMutable(backgroundMusicEntity)
        audioMutable.playing = true
      } else if (audio.playing && !audioStarted) {
        // Audio is playing successfully
        audioStarted = true
        console.log(`[Audio] ✓ Background music is now playing!`)
      }
    }
  })
  
  // Also try to start audio on any pointer event (user interaction)
  // This helps bypass browser autoplay restrictions
  pointerEventsSystem.onPointerDown(
    {
      entity: engine.RootEntity,
      opts: {
        button: InputAction.IA_POINTER,
        hoverText: '',
        showFeedback: false,
        maxDistance: 1000
      }
    },
    () => {
      if (backgroundMusicEntity && AudioSource.has(backgroundMusicEntity)) {
        const audio = AudioSource.getMutable(backgroundMusicEntity)
        if (!audio.playing) {
          audio.playing = true
          console.log(`[Audio] Background music started via user interaction`)
        }
      }
    }
  )
  
  return backgroundMusicEntity
}

/**
 * Play a sound effect once (non-looping)
 * Example: playSoundEffect('sounds/jump.mp3', 0.8)
 * Note: Entity cleanup should be handled by the caller or via a system
 */
export function playSoundEffect(audioPath: string, volume: number = 1.0) {
  const soundEntity = engine.addEntity()
  
  AudioSource.create(soundEntity, {
    audioClipUrl: audioPath,
    playing: true,
    loop: false,
    volume: volume
  })
  
  // Return entity so caller can manage cleanup if needed
  return soundEntity
}
