import { type CliRenderer } from "@opentui/core"
import * as addons from "@opentui/keymap/addons/opentui"
import {
  formatCommandBindings as formatCommandBindingsExtra,
  formatKeySequence as formatKeySequenceExtra,
} from "@opentui/keymap/extras"
import {
  KeymapProvider,
  useBindings,
  useKeymap,
  useKeymapSelector,
} from "@opentui/keymap/solid"
import { createMemo, type Accessor } from "solid-js"
import type { TuiConfig } from "./config/tui"
import { useTuiConfig } from "./context/tui-config"

export const LEADER_TOKEN = "leader"
export const OPENCODE_BASE_MODE = "base"
export const COMMAND_PALETTE_COMMAND = "command.palette.show"

const OPENCODE_MODE_KEY = "opencode.mode"

export const OpencodeKeymapProvider = KeymapProvider
export const useOpencodeKeymap = useKeymap

export { useBindings, useKeymapSelector }

export type OpenTuiKeymap = ReturnType<typeof useKeymap>
type OpencodeModeStack = ReturnType<typeof createOpencodeModeStack>
type CommandSlashEntry = {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}
type CommandEntry = ReturnType<OpenTuiKeymap["getCommandEntries"]>[number]

const modeStacks = new WeakMap<OpenTuiKeymap, OpencodeModeStack>()

function isVisiblePaletteCommand(entry: CommandEntry) {
  return entry.command.hidden !== true && entry.command.name !== COMMAND_PALETTE_COMMAND
}

export function createOpencodeModeStack(keymap: OpenTuiKeymap) {
  keymap.setData(OPENCODE_MODE_KEY, OPENCODE_BASE_MODE)

  const offFields = keymap.registerLayerFields({
    opencodeMode(value, ctx) {
      ctx.require(OPENCODE_MODE_KEY, value)
    },
  })

  const stack: { id: symbol; mode: string }[] = []
  let disposed = false

  const update = () => {
    keymap.setData(OPENCODE_MODE_KEY, stack.at(-1)?.mode ?? OPENCODE_BASE_MODE)
  }

  const stackApi = {
    push(mode: string) {
      if (disposed) return () => {}
      const id = Symbol(mode)
      let active = true
      stack.push({ id, mode })
      update()

      return () => {
        if (!active) return
        active = false
        const index = stack.findIndex((item) => item.id === id)
        if (index !== -1) stack.splice(index, 1)
        update()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stack.length = 0
      offFields()
      keymap.setData(OPENCODE_MODE_KEY, undefined)
    },
  }

  modeStacks.set(keymap, stackApi)
  return stackApi
}

export function useOpencodeModeStack() {
  const value = modeStacks.get(useOpencodeKeymap())
  if (!value) throw new Error("Opencode mode stack is not registered for this keymap")
  return value
}

function formatOptions(config: TuiConfig.Resolved) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: config.keymap.leader,
    },
    keyNameAliases: {
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del",
    },
    modifierAliases: {
      meta: "alt",
    },
  } as const
}

export function formatKeySequence(parts: Parameters<typeof formatKeySequenceExtra>[0], config: TuiConfig.Resolved) {
  return formatKeySequenceExtra(parts, formatOptions(config))
}

export function formatKeyBindings(
  bindings: Parameters<typeof formatCommandBindingsExtra>[0],
  config: TuiConfig.Resolved,
) {
  return formatCommandBindingsExtra(bindings, formatOptions(config))
}

export function registerOpencodeKeymap(keymap: OpenTuiKeymap, renderer: CliRenderer, config: TuiConfig.Resolved) {
  const offCommaBindings = addons.registerCommaBindings(keymap)
  const offBaseLayout = addons.registerBaseLayoutFallback(keymap)
  const offLeader = addons.registerTimedLeader(keymap, {
    trigger: config.keymap.leader,
    name: LEADER_TOKEN,
    timeoutMs: config.keymap.leader_timeout,
  })
  const offEscape = addons.registerEscapeClearsPendingSequence(keymap)
  const offBackspace = addons.registerBackspacePopsPendingSequence(keymap)
  const offInputBindings = addons.registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => renderer.currentFocusedEditor !== null,
    bindings: config.keymap.sections.input,
  })

  return () => {
    offInputBindings()
    offBackspace()
    offEscape()
    offLeader()
    offBaseLayout()
    offCommaBindings()
  }
}

export function useCommandShortcut(command: string): Accessor<string> {
  const config = useTuiConfig()
  return useKeymapSelector((keymap) =>
    formatKeySequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)?.[0]?.sequence,
      config,
    ),
  )
}

export function useLeaderActive(): Accessor<boolean> {
  return useKeymapSelector((keymap: OpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === LEADER_TOKEN)
}

export function useCommandSlashes(): Accessor<readonly CommandSlashEntry[]> {
  const keymap = useOpencodeKeymap()
  const entries = useKeymapSelector((keymap: OpenTuiKeymap) =>
    keymap
      .getCommandEntries({
        visibility: "reachable",
        namespace: "palette",
      })
      .filter(isVisiblePaletteCommand),
  )

  return createMemo<CommandSlashEntry[]>(() =>
    entries().flatMap((entry) => {
      const slashName = entry.command.slashName
      if (typeof slashName !== "string" || !slashName) return []
      const slashAliases = entry.command.slashAliases
      return {
        display: `/${slashName}`,
        description:
          typeof entry.command.desc === "string"
            ? entry.command.desc
            : typeof entry.command.title === "string"
              ? entry.command.title
              : undefined,
        aliases: Array.isArray(slashAliases)
          ? slashAliases.filter((alias): alias is string => typeof alias === "string").map((alias) => `/${alias}`)
          : undefined,
        onSelect: () => keymap.dispatchCommand(entry.command.name),
      }
    }),
  )
}
