/**
 * Application state. Persisted to localStorage so a configuration survives a
 * reload, which matters because planning a pegboard is not a one-sitting task.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HoleId, Rotation } from '../lib/grid'
import type { LanguageId } from '../data/catalog'
import {
  clampCustomPart,
  MAX_CUSTOM_PARTS,
  newCustomKey,
  type CustomPart,
} from '../data/customParts'
import { detectLanguage } from '../i18n/detect'
import { canRotateBoard, MAX_BOARDS } from '../lib/wall'
import type { PriceMarketId } from '../lib/pricing'
import type { PriceTable } from '../lib/ikeaSearch'

export interface Placement {
  id: string
  itemKey: string
  holeId: HoleId
  /** Quarter-turn rotation, counter-clockwise. */
  rotation: Rotation
  /** Which board on the wall this hangs on. */
  boardIndex: number
}

/**
 * A board placed on the wall. Hole ids stay board-relative — the offset lives
 * here — so every existing grid function keeps working unchanged and only
 * collision and snapping need to think in wall space.
 */
export interface PlacedBoard {
  boardKey: string
  /** Millimetres from the wall origin to this board's bottom-left corner. */
  offsetX: number
  offsetY: number
  /**
   * True when this panel hangs a quarter turn from how it is sold — a 36×56
   * board read as 56×36. Not a camera trick: it changes the hole field, so it
   * lives with the configuration and travels in a share link.
   */
  rotated: boolean
}

export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * The part of the configuration undo/redo covers: the board edit itself.
 *
 * `customParts` belongs here because deleting one also deletes its placements.
 * Without it, undoing a delete would restore placements pointing at a part that
 * no longer exists, and the `pruneUnresolvable` pass would silently eat them
 * again — an undo that visibly does nothing.
 */
interface EditSnapshot {
  boards: PlacedBoard[]
  placements: Placement[]
  customParts: CustomPart[]
}

/** Deep enough history to be useful, bounded so it cannot grow without limit. */
const HISTORY_LIMIT = 50

interface ConfigState {
  /** The wall: one or more boards side by side. Never empty. */
  boards: PlacedBoard[]
  placements: Placement[]
  selectedId: string | null
  /**
   * User-defined placeholder bodies. Persisted, but deliberately NOT shareable:
   * they are one person's view of their own wall, not a shopping list.
   */
  customParts: CustomPart[]

  market: PriceMarketId
  customCurrency: string
  language: LanguageId
  theme: ThemePreference
  /** Width of the 3D pane as a fraction of the window, 0.3–0.7. */
  viewRatio: number
  /**
   * Height of the 3D pane as a fraction of the viewport, 0.4–1.5.
   *
   * A floor, not a fixed size: the pane always fills the space it is given, and
   * this raises it above that. Shrinking below the natural fill would only add
   * dead space, because the other two panes sit beside the stage rather than
   * under it — so the useful direction is up, past the bottom of the window.
   */
  viewHeight: number
  /** Projection used for the printed diagram. */
  printAngle: 'front' | 'iso'

  /** User-entered prices by catalog key. Always beat fetched prices. */
  overrides: Record<string, number>
  /** Catalog keys the user has unchecked — still listed, not counted. */
  excluded: Record<string, true>
  /** Cost-only items (connectors, bundles) the user added without placing. */
  extras: Record<string, number>

  /** Undo/redo stacks. Session-only — never persisted. */
  past: EditSnapshot[]
  future: EditSnapshot[]

  setBoard: (key: string, index?: number) => void
  /** Turn one board a quarter turn. Clears that board, like resizing it does. */
  rotateBoard: (index: number) => void
  addBoard: (key: string) => void
  removeBoard: (index: number) => void
  place: (itemKey: string, holeId: HoleId, rotation: Rotation, boardIndex: number) => void
  move: (id: string, holeId: HoleId, rotation: Rotation, boardIndex: number) => void
  rotate: (id: string) => void
  remove: (id: string) => void
  select: (id: string | null) => void
  clearBoard: () => void
  /** Drop placements that no longer resolve against the current board. */
  pruneUnresolvable: (ids: readonly string[]) => void

  /** Returns the new part's key, or null when the cap is already reached. */
  addCustomPart: (part: Omit<CustomPart, 'key'>) => string | null
  updateCustomPart: (key: string, part: Omit<CustomPart, 'key'>) => void
  /** Removes the part and every placement of it. */
  removeCustomPart: (key: string) => void

  setMarket: (market: PriceMarketId) => void
  setCustomCurrency: (currency: string) => void
  setLanguage: (language: LanguageId) => void
  setTheme: (theme: ThemePreference) => void
  setViewRatio: (ratio: number) => void
  setViewHeight: (height: number) => void
  setPrintAngle: (angle: 'front' | 'iso') => void

  setOverride: (key: string, price: number | null) => void
  toggleIncluded: (key: string) => void
  setExtra: (key: string, quantity: number) => void

  undo: () => void
  redo: () => void
  /** Replace the whole configuration from a shared link. Clears history. */
  applyShared: (config: SharedConfigInput) => void
}

/** Shape accepted from a decoded share link. */
export interface SharedConfigInput {
  boards: PlacedBoard[]
  market: string
  currency: string
  placements: Array<{
    itemKey: string
    holeId: HoleId
    rotation: Rotation
    boardIndex: number
  }>
  excluded: string[]
  overrides: Record<string, number>
  extras: Record<string, number>
}

function snapshot(state: ConfigState): EditSnapshot {
  return {
    boards: state.boards,
    placements: state.placements,
    customParts: state.customParts,
  }
}

/**
 * Records the pre-edit state for undo and drops any redo branch, which is the
 * standard behaviour once you edit after undoing.
 */
function remember(state: ConfigState): Pick<ConfigState, 'past' | 'future'> {
  return {
    past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
  }
}

let placementSeq = 0
function nextId(): string {
  placementSeq += 1
  return `p${Date.now().toString(36)}${placementSeq.toString(36)}`
}


/**
 * Persist migration, exported so it can be tested directly.
 *
 * Every branch here runs against a blob written by an older build, which is the
 * one input that cannot be re-created by using the app. Keep each step
 * independent and additive: a user four versions behind runs all of them in
 * order, so no step may assume a later one has already happened.
 */
export function migrateConfig(persisted: unknown, version: number): ConfigState {
  const state = persisted as ConfigState
  if (version < 2 && Array.isArray(state?.placements)) {
    state.placements = state.placements.map((p) => ({ ...p, rotation: p.rotation ?? 0 }))
  }
  if (version < 3) state.viewRatio ??= 0.55
  if (version < 4) state.printAngle ??= 'front'
  // v4 held a single boardKey; v5 is a wall of boards.
  if (version < 5) {
    const legacy = (state as unknown as { boardKey?: string }).boardKey
    state.boards ??= [
      { boardKey: legacy ?? 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false },
    ]
    state.placements = (state.placements ?? []).map((p) => ({
      ...p,
      boardIndex: p.boardIndex ?? 0,
    }))
    delete (state as unknown as { boardKey?: string }).boardKey
  }
  // v6 dropped the double-sided boards; point saved walls at the same
  // size in white rather than falling back to a different board size.
  if (version < 6) {
    const replaced: Record<string, string> = {
      'board-36x56-multi': 'board-36x56-white',
      'board-76x56-multi': 'board-76x56-white',
    }
    state.boards = (state.boards ?? []).map((b) => ({
      ...b,
      boardKey: replaced[b.boardKey] ?? b.boardKey,
    }))
  }
  // v7 introduced user-defined custom components.
  if (version < 7) state.customParts ??= []
  // v8 lets a panel hang sideways. Everything saved before it was upright.
  if (version < 8) {
    state.boards = (state.boards ?? []).map((b) => ({ ...b, rotated: b.rotated ?? false }))
  }
  // v9 added the stage height control. The default is the height the pane
  // already filled, so a v8 configuration reopens looking identical.
  if (version < 9) state.viewHeight ??= 0.4
  return state
}

export const useConfig = create<ConfigState>()(
  persist(
    (set) => ({
      boards: [{ boardKey: 'board-56x56-white', offsetX: 0, offsetY: 0, rotated: false }],
      placements: [],
      selectedId: null,
      customParts: [],

      market: 'us',
      customCurrency: 'TWD',
      // First visit follows the browser; after that the stored choice wins.
      language: detectLanguage(),
      // Light unless the visitor says otherwise. Following the OS silently
      // means the app can come up dark for someone who never asked for that;
      // 'system' stays available in the picker as an explicit choice.
      theme: 'light',
      viewRatio: 0.55,
      // 0.4 reproduces the pre-control layout exactly: it sits below the height
      // the pane already fills on any normal window, so an existing saved
      // configuration looks unchanged until the user reaches for the slider.
      viewHeight: 0.4,
      printAngle: 'front',

      overrides: {},
      excluded: {},
      extras: {},
      past: [],
      future: [],

      // Changing a board's size strands placements on holes that no longer
      // exist, so that board is cleared rather than silently dropping items.
      setBoard: (boardKey, index = 0) =>
        set((state) => ({
          ...remember(state),
          boards: state.boards.map((b, i) =>
            i === index
              ? { ...b, boardKey, rotated: b.rotated && canRotateBoard(boardKey) }
              : b,
          ),
          placements: state.placements.filter((p) => p.boardIndex !== index),
          selectedId: null,
        })),

      addBoard: (boardKey) =>
        set((state) => {
          if (state.boards.length >= MAX_BOARDS) return state
          return {
            ...remember(state),
            boards: [...state.boards, { boardKey, offsetX: 0, offsetY: 0, rotated: false }],
            selectedId: null,
          }
        }),

      // Placements on the removed board go with it, and later boards shift
      // down an index so the two stay in step.
      removeBoard: (index) =>
        set((state) => {
          if (state.boards.length <= 1) return state
          return {
            ...remember(state),
            boards: state.boards.filter((_, i) => i !== index),
            placements: state.placements
              .filter((p) => p.boardIndex !== index)
              .map((p) => (p.boardIndex > index ? { ...p, boardIndex: p.boardIndex - 1 } : p)),
            selectedId: null,
          }
        }),

      // Rotating rebuilds the hole field from a different lattice phase, so no
      // remap of the existing placements would preserve their meaning — and
      // turning the accessories with the panel would be wrong anyway, because
      // gravity does not rotate (findings F24). Cleared, and undoable.
      rotateBoard: (index) =>
        set((state) => {
          const board = state.boards[index]
          if (!board || !canRotateBoard(board.boardKey)) return state
          return {
            ...remember(state),
            boards: state.boards.map((b, i) =>
              i === index ? { ...b, rotated: !b.rotated } : b,
            ),
            placements: state.placements.filter((p) => p.boardIndex !== index),
            selectedId: null,
          }
        }),

      place: (itemKey, holeId, rotation, boardIndex) =>
        set((state) => ({
          ...remember(state),
          placements: [
            ...state.placements,
            { id: nextId(), itemKey, holeId, rotation, boardIndex },
          ],
        })),

      move: (id, holeId, rotation, boardIndex) =>
        set((state) => ({
          ...remember(state),
          placements: state.placements.map((p) =>
            p.id === id ? { ...p, holeId, rotation, boardIndex } : p,
          ),
        })),

      rotate: (id) =>
        set((state) => ({
          ...remember(state),
          placements: state.placements.map((p) =>
            p.id === id ? { ...p, rotation: (((p.rotation + 90) % 360) as Rotation) } : p,
          ),
        })),

      remove: (id) =>
        set((state) => ({
          ...remember(state),
          placements: state.placements.filter((p) => p.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),

      select: (selectedId) => set({ selectedId }),
      clearBoard: () =>
        set((state) => ({ ...remember(state), placements: [], selectedId: null })),

      pruneUnresolvable: (ids) =>
        set((state) => {
          if (ids.length === 0) return state
          const drop = new Set(ids)
          return {
            placements: state.placements.filter((p) => !drop.has(p.id)),
            selectedId:
              state.selectedId && drop.has(state.selectedId) ? null : state.selectedId,
          }
        }),

      addCustomPart: (part) => {
        let created: string | null = null
        set((state) => {
          if (state.customParts.length >= MAX_CUSTOM_PARTS) return state
          const next = clampCustomPart({ ...part, key: newCustomKey() })
          created = next.key
          return { ...remember(state), customParts: [...state.customParts, next] }
        })
        return created
      },

      // Clamped here, not only in the form: `migrate` is skipped entirely when
      // the persisted version already matches, so a hand-edited localStorage
      // blob would otherwise reach the scene unchecked.
      updateCustomPart: (key, part) =>
        set((state) => ({
          ...remember(state),
          customParts: state.customParts.map((p) =>
            p.key === key ? clampCustomPart({ ...part, key }) : p,
          ),
        })),

      removeCustomPart: (key) =>
        set((state) => {
          const dropped = new Set(
            state.placements.filter((p) => p.itemKey === key).map((p) => p.id),
          )
          return {
            ...remember(state),
            customParts: state.customParts.filter((p) => p.key !== key),
            placements: state.placements.filter((p) => !dropped.has(p.id)),
            selectedId:
              state.selectedId && dropped.has(state.selectedId) ? null : state.selectedId,
          }
        }),

      setMarket: (market) => set({ market }),
      setCustomCurrency: (customCurrency) => set({ customCurrency }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setViewRatio: (viewRatio) => set({ viewRatio: Math.min(0.7, Math.max(0.3, viewRatio)) }),
      setViewHeight: (viewHeight) =>
        set({ viewHeight: Math.min(1.5, Math.max(0.4, viewHeight)) }),
      setPrintAngle: (printAngle) => set({ printAngle }),

      setOverride: (key, price) =>
        set((state) => {
          const overrides = { ...state.overrides }
          if (price === null || Number.isNaN(price)) delete overrides[key]
          else overrides[key] = price
          return { overrides }
        }),

      toggleIncluded: (key) =>
        set((state) => {
          const excluded = { ...state.excluded }
          if (excluded[key]) delete excluded[key]
          else excluded[key] = true
          return { excluded }
        }),

      undo: () =>
        set((state) => {
          const previous = state.past.at(-1)
          if (!previous) return state
          return {
            past: state.past.slice(0, -1),
            future: [...state.future, snapshot(state)],
            boards: previous.boards,
            placements: previous.placements,
            customParts: previous.customParts,
            selectedId: null,
          }
        }),

      redo: () =>
        set((state) => {
          const next = state.future.at(-1)
          if (!next) return state
          return {
            future: state.future.slice(0, -1),
            past: [...state.past, snapshot(state)],
            boards: next.boards,
            placements: next.placements,
            customParts: next.customParts,
            selectedId: null,
          }
        }),

      applyShared: (config) =>
        set({
          boards: config.boards,
          placements: config.placements.map((p) => ({ ...p, id: nextId() })),
          market: config.market as PriceMarketId,
          customCurrency: config.currency,
          overrides: config.overrides,
          extras: config.extras,
          excluded: Object.fromEntries(config.excluded.map((k) => [k, true as const])),
          selectedId: null,
          // A link is a starting point, not a step you can undo past.
          past: [],
          future: [],
        }),

      setExtra: (key, quantity) =>
        set((state) => {
          const extras = { ...state.extras }
          if (quantity <= 0) delete extras[key]
          else extras[key] = quantity
          return { extras }
        }),
    }),
    {
      name: 'skadis-config',
      version: 9,
      // v1 placements predate rotation; default them to upright rather than
      // discarding a saved configuration.
      migrate: migrateConfig,
      // selectedId is transient UI state — persisting it would restore a
      // selection for an item the user may have since deleted.
      partialize: (state) => {
        const persisted = { ...state }
        delete (persisted as Partial<ConfigState>).selectedId
        // History is a session concern; restoring it would let a reload undo
        // its way into a board the user never saw this session.
        delete (persisted as Partial<ConfigState>).past
        delete (persisted as Partial<ConfigState>).future
        return persisted
      },
    },
  ),
)

/**
 * Live prices are session state, not user data — never persisted.
 *
 * `idle` is now the normal state, not a transient one: nothing is fetched
 * unless the user asks for it, so most sessions never leave it and price the
 * wall from the committed snapshot.
 */
interface PriceState {
  live?: PriceTable
  /**
   * The market `live` was fetched for. Prices are keyed by article number, and
   * article numbers differ per market, so a table fetched for one market must
   * never be read against another — it would silently miss every lookup and
   * degrade to the snapshot while claiming to be live.
   */
  liveMarket?: PriceMarketId
  status: 'idle' | 'loading' | 'ok' | 'error'
  error?: string
  setLoading: () => void
  setPrices: (market: PriceMarketId, prices: PriceTable) => void
  setError: (message: string) => void
}

export const usePrices = create<PriceState>()((set) => ({
  status: 'idle',
  setLoading: () => set({ status: 'loading', error: undefined }),
  setPrices: (liveMarket, live) => set({ live, liveMarket, status: 'ok', error: undefined }),
  setError: (error) =>
    set({ status: 'error', error, live: undefined, liveMarket: undefined }),
}))
