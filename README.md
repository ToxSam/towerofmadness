# Tower of Madness 🏗️

A procedurally generated tower climbing game for Decentraland SDK7. Climb randomly generated towers, track your progress, and compete for the best time and height! Features multiplayer support for collaborative climbing experiences.

## 🎮 Features

### Procedural Tower Generation
- **Random Tower Creation**: Each tower is procedurally generated with 3-6 random middle chunks
- **Automatic Generation**: Tower generates automatically on scene load
- **Regeneration**: Click the button panel to clear and regenerate a new random tower
- **Smart Stacking**: Chunks are stacked with alternating 180° rotations for visual variety
- **Chunk Tracking**: UI displays all chunks used in the current tower (from top to bottom)

### Game Mechanics
- **Height Tracking**: Real-time player height monitoring
- **Game Timer**: Tracks time from start to finish
- **Best Scores**: Records your best time and highest height reached
- **Win Condition**: Reach the top (ChunkEnd) to win
- **Death System**: Fall detection with restart capability

### User Interface
- **Player Height Display**: Shows current player height in the center of the screen
- **Game Timer**: Displays elapsed time when game is active
- **Best Scores Panel**: Top-right display of best time and best height
- **Tower Chunks List**: Shows all chunks used in current tower (below best scores)
- **Game Status Messages**: Visual feedback for game start, win, and death states

## 🏗️ Tower Structure

### Chunk Types
- **ChunkStart**: Base chunk (permanently placed at Y=0, position 40, 0, 40)
- **Middle Chunks**: Randomly selected from Chunk01, Chunk02, Chunk03
- **ChunkEnd**: Top chunk that triggers win condition

### Stacking Logic
- Each chunk has a height of **10.821 units**
- Chunks stack vertically with alternating rotations:
  - Even indices (0, 2, 4...): 180° Y rotation
  - Odd indices (1, 3, 5...): 0° Y rotation
- ChunkEnd rotation matches the last middle chunk's rotation pattern

### Generation Rules
- **Middle Chunks**: 3-6 chunks randomly selected (can repeat)
- **Position**: All chunks spawn at X=40, Z=40 (same as ChunkStart)
- **Height Calculation**: `(total middle chunks + 1) × 10.821`

## 🎯 Game Flow

1. **Scene Load**: Tower automatically generates
2. **Game Start**: Player enters TriggerStart area
3. **Climbing**: Player climbs the procedurally generated tower
4. **Win**: Player reaches TriggerEnd (at ChunkEnd)
5. **Death**: Player falls and hits TriggerDeath area
6. **Restart**: Return to TriggerStart to begin again

## 🛠️ Technical Details

### Built With
- **Decentraland SDK7**: Latest ECS architecture
- **TypeScript**: Type-safe development
- **React ECS**: UI rendering system

### Key Components

#### `towerGenerator.ts`
- Manages tower generation and chunk placement
- Tracks chunk usage for UI display
- Handles entity cleanup on regeneration
- Exports tower height and chunk list

#### `index.ts`
- Main game logic and state management
- Trigger area detection (Start, End, Death)
- Player height tracking system
- Game timer system
- Button panel interaction

#### `ui.tsx`
- Real-time UI updates
- Player height display
- Game timer display
- Best scores tracking
- Tower chunks list

## 📦 Installation & Setup

### Prerequisites
- Node.js >= 16.0.0
- npm >= 6.0.0

### Installation
```bash
npm install
```

### Development
```bash
npm run start
```

### Build
```bash
npm run build
```

### Deploy
```bash
npm run deploy
```

## 📁 Project Structure

```
Tower of Madness/
├── src/
│   ├── index.ts           # Main game logic
│   ├── towerGenerator.ts  # Tower generation system
│   └── ui.tsx             # UI components
├── assets/
│   ├── chunks/            # Tower chunk models
│   │   ├── ChunkStart.glb
│   │   ├── Chunk01.glb
│   │   ├── Chunk02.glb
│   │   ├── Chunk03.glb
│   │   └── ChunkEnd.glb
│   └── scene/             # Scene configuration
├── scene.json             # Scene metadata
└── package.json           # Dependencies
```

## 🎨 UI Layout

```
┌─────────────────────────────────────────┐
│  Top Center:                            │
│  ┌─────────────────────┐               │
│  │ Player Height        │               │
│  │ Game Timer (active) │               │
│  └─────────────────────┘               │
│                                         │
│  Top Right:                             │
│  ┌─────────────────────┐               │
│  │ Best Time           │               │
│  │ Best Height         │               │
│  └─────────────────────┘               │
│  ┌─────────────────────┐               │
│  │ 5 chunks            │               │
│  │ ChunkEnd            │               │
│  │ Chunk02             │               │
│  │ Chunk01             │               │
│  │ Chunk03             │               │
│  │ Chunk01             │               │
│  │ ChunkStart          │               │
│  └─────────────────────┘               │
│                                         │
│  Center:                                 │
│  Player Height (when not in game)       │
└─────────────────────────────────────────┘
```

## 🎮 Controls

- **Movement**: Standard Decentraland WASD controls
- **Jump**: Space bar
- **Interact**: Click button panel to regenerate tower
- **Start Game**: Enter TriggerStart area
- **Win**: Reach TriggerEnd at the top
- **Restart**: Return to TriggerStart after death

## 📊 Game Statistics

The game tracks:
- **Current Height**: Real-time player Y position
- **Game Timer**: Elapsed time during active game
- **Best Time**: Fastest completion time
- **Best Height**: Highest point reached
- **Tower Height**: Current tower's total height
- **Chunk Count**: Number of chunks in current tower

## 🔧 Configuration

### Tower Generation
Edit `src/towerGenerator.ts` to modify:
- `MIN_MIDDLE_CHUNKS`: Minimum middle chunks (default: 3)
- `MAX_MIDDLE_CHUNKS`: Maximum middle chunks (default: 6)
- `CHUNK_HEIGHT`: Height of each chunk (default: 10.821)
- `TOWER_X`, `TOWER_Z`: Tower base position (default: 40, 40)

## 🚀 Future Enhancements

Potential features to add:
- Difficulty levels (more chunks, different patterns)
- Power-ups and collectibles
- Multiplayer leaderboards
- Particle effects on chunk placement
- Sound effects and music
- More chunk variety

## 📝 License

This project is open source and available for use in Decentraland scenes.

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

---

**Built with ❤️ for Decentraland**
