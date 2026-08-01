import type {
  AvailableCommand,
  SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react'
import { TFile } from 'obsidian'
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import type { SessionModeState } from '../../types/chat'

import { AttachedNote, NotePicker } from './NotePicker'
import {
  ConfigOptionSelect,
  EFFORT_ICON,
  ModeSelect,
  findConfigOption,
} from './selects'
import { useActiveFile } from './useActiveFile'

export type InputImage = {
  mimeType: string
  data: string
  previewUrl: string
}

export type { AttachedNote }

type ChatInputProps = {
  running: boolean
  disabled: boolean
  commands: AvailableCommand[]
  mode: SessionModeState | null
  configOptions: SessionConfigOption[]
  onModeChange: (modeId: string) => void
  onConfigOptionChange: (configId: string, value: string) => void
  onSubmit: (text: string, images: InputImage[], notes: AttachedNote[]) => void
  onCancel: () => void
}

function readImageFile(file: File): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const match = result.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        reject(new Error('Failed to read image'))
        return
      }
      resolve({
        mimeType: match[1],
        data: match[2],
        previewUrl: result,
      })
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image'))
    }
    reader.readAsDataURL(file)
  })
}

const TEXT_FILE_EXT =
  /\.(md|markdown|txt|text|json|jsonc|csv|tsv|log|ya?ml|xml|toml|ini)$/i

function isTextLikeFile(file: File): boolean {
  return (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    TEXT_FILE_EXT.test(file.name)
  )
}

function resolveFilePath(file: File): string | null {
  try {
    const req = (window as unknown as { require?: (id: string) => unknown })
      .require
    const electron = req?.('electron') as
      { webUtils?: { getPathForFile?: (target: File) => string } } | undefined
    const resolved = electron?.webUtils?.getPathForFile?.(file)
    if (resolved) return resolved
  } catch {
    // fall through to the legacy property
  }
  return (file as File & { path?: string }).path ?? null
}

export const FILE_INPUT_ACCEPT =
  'image/*,text/*,.md,.markdown,.json,.jsonc,.csv,.tsv,.log,.yaml,.yml,.xml,.toml,.ini'

function ChatInput({
  running,
  disabled,
  commands,
  mode,
  configOptions,
  onModeChange,
  onConfigOptionChange,
  onSubmit,
  onCancel,
}: ChatInputProps) {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const [images, setImages] = useState<InputImage[]>([])
  const [notes, setNotes] = useState<TFile[]>([])
  const [externalFiles, setExternalFiles] = useState<AttachedNote[]>([])
  const [excludedCurrentPath, setExcludedCurrentPath] = useState<string | null>(
    null,
  )
  const [commandIndex, setCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeFile = useActiveFile()

  const currentNote =
    activeFile &&
    activeFile.extension === 'md' &&
    activeFile.path !== excludedCurrentPath
      ? activeFile
      : null

  const activePath = activeFile?.path ?? null
  useEffect(() => {
    setExcludedCurrentPath(null)
  }, [activePath])

  const selectedNotePaths = useMemo(() => {
    const paths = new Set(notes.map((note) => note.path))
    if (currentNote) paths.add(currentNote.path)
    return paths
  }, [notes, currentNote])

  const toggleNote = (file: TFile) => {
    if (activeFile && file.path === activeFile.path) {
      setExcludedCurrentPath((prev) => (prev === file.path ? null : file.path))
      setNotes((prev) => prev.filter((note) => note.path !== file.path))
      return
    }
    setNotes((prev) =>
      prev.some((note) => note.path === file.path)
        ? prev.filter((note) => note.path !== file.path)
        : [...prev, file],
    )
  }

  const commandQuery = useMemo(() => {
    if (!text.startsWith('/')) return null
    const firstLine = text.split('\n')[0]
    if (firstLine.includes(' ')) return null
    return firstLine.slice(1).toLowerCase()
  }, [text])

  const matchedCommands = useMemo(() => {
    if (commandQuery === null) return []
    return commands
      .filter((command) => command.name.toLowerCase().includes(commandQuery))
      .slice(0, 8)
  }, [commands, commandQuery])

  useEffect(() => {
    setCommandIndex(0)
  }, [commandQuery])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.setCssProps({ height: 'auto' })
    textarea.setCssProps({
      height: `${Math.min(textarea.scrollHeight, 160)}px`,
    })
  }, [text])

  const doSubmit = () => {
    const trimmed = text.trim()
    const attached: AttachedNote[] = [
      ...(currentNote
        ? [{ path: currentNote.path, name: currentNote.basename }]
        : []),
      ...notes.map((note) => ({ path: note.path, name: note.basename })),
      ...externalFiles.map((file) => ({ ...file, absolute: true })),
    ]
    if ((!trimmed && images.length === 0 && attached.length === 0) || disabled)
      return
    onSubmit(trimmed, images, attached)
    setText('')
    setImages([])
    setNotes([])
    setExternalFiles([])
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matchedCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex((index) =>
          Math.min(index + 1, matchedCommands.length - 1),
        )
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const command = matchedCommands[commandIndex]
        if (command) {
          setText(`/${command.name} `)
        }
        return
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      doSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (file) {
          void readImageFile(file).then((image) => {
            setImages((prev) => [...prev, image])
          })
        }
        return
      }
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        void readImageFile(file).then((image) => {
          setImages((prev) => [...prev, image])
        })
        continue
      }
      if (isTextLikeFile(file)) {
        const absolutePath = resolveFilePath(file)
        if (absolutePath) {
          setExternalFiles((prev) =>
            prev.some((item) => item.path === absolutePath)
              ? prev
              : [...prev, { name: file.name, path: absolutePath }],
          )
        }
      }
    }
  }

  const modelOption = findConfigOption(configOptions, 'model')
  const effortOption =
    findConfigOption(configOptions, 'thought_level') ??
    configOptions.find((option) => option.id === 'effort') ??
    null

  return (
    <div className="yolo-chat-input-wrapper">
      {matchedCommands.length > 0 ? (
        <div className="yolo-popover-surface yolo-popover-surface--default yolo-acp-command-popup">
          <div className="yolo-model-select-list" role="menu">
            {matchedCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                className={`yolo-popover-item yolo-acp-command-item${
                  index === commandIndex ? ' is-active' : ''
                }`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  setText(`/${command.name} `)
                  textareaRef.current?.focus()
                }}
              >
                <span className="yolo-acp-command-item__content">
                  <span className="yolo-acp-command-item__label">
                    /{command.name}
                  </span>
                  {command.description ? (
                    <span className="yolo-acp-command-desc">
                      {command.description}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="yolo-chat-user-input-container">
        <div className="yolo-chat-user-input-wrapper">
          {currentNote ||
          notes.length > 0 ||
          externalFiles.length > 0 ||
          images.length > 0 ? (
            <div className="yolo-chat-user-input-files">
              {currentNote ? (
                <span
                  className="yolo-acp-note-chip is-current"
                  title={currentNote.path}
                >
                  <button
                    type="button"
                    className="yolo-acp-note-chip__remove"
                    onClick={() => setExcludedCurrentPath(currentNote.path)}
                  >
                    <X size={12} />
                  </button>
                  <FileText size={12} className="yolo-acp-note-chip__icon" />
                  <span className="yolo-acp-note-chip__name">
                    {currentNote.basename}
                  </span>
                </span>
              ) : null}
              {notes.map((note) => (
                <span
                  key={note.path}
                  className="yolo-acp-note-chip"
                  title={note.path}
                >
                  <button
                    type="button"
                    className="yolo-acp-note-chip__remove"
                    onClick={() =>
                      setNotes((prev) =>
                        prev.filter((item) => item.path !== note.path),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                  <FileText size={12} className="yolo-acp-note-chip__icon" />
                  <span className="yolo-acp-note-chip__name">
                    {note.basename}
                  </span>
                </span>
              ))}
              {externalFiles.map((file) => (
                <span
                  key={file.path}
                  className="yolo-acp-note-chip"
                  title={file.path}
                >
                  <button
                    type="button"
                    className="yolo-acp-note-chip__remove"
                    onClick={() =>
                      setExternalFiles((prev) =>
                        prev.filter((item) => item.path !== file.path),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                  <Paperclip size={12} className="yolo-acp-note-chip__icon" />
                  <span className="yolo-acp-note-chip__name">{file.name}</span>
                </span>
              ))}
              {images.map((image, index) => (
                <div key={index} className="yolo-acp-input-image">
                  <img src={image.previewUrl} alt="" />
                  <button
                    className="yolo-acp-input-image-remove"
                    onClick={() =>
                      setImages((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="yolo-chat-user-input-editor">
            <textarea
              ref={textareaRef}
              className="yolo-acp-textarea"
              placeholder={t('chat.inputPlaceholder', 'Ask anything…')}
              value={text}
              rows={1}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
          <div className="yolo-chat-user-input-send-row">
            <NotePicker
              selected={selectedNotePaths}
              disabled={disabled}
              onToggle={toggleNote}
              onPickFile={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={(event) => {
                handleFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <div className="yolo-chat-user-input-send-row__right">
              {running ? (
                <button
                  type="button"
                  className="yolo-chat-user-input-submit-button-circle is-stop"
                  title={t('chat.stopGenerating', 'Stop')}
                  onClick={onCancel}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="yolo-chat-user-input-submit-button-circle"
                  title={t('common.send', 'Send')}
                  onClick={doSubmit}
                  disabled={disabled || (!text.trim() && images.length === 0)}
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="yolo-chat-user-input-toolbar">
        <div className="yolo-chat-user-input-toolbar__left">
          <ModeSelect
            current={mode?.current ?? 'build'}
            available={mode?.available ?? []}
            onChange={onModeChange}
          />
        </div>
        <div className="yolo-chat-user-input-toolbar__right">
          {effortOption ? (
            <ConfigOptionSelect
              option={effortOption}
              icon={EFFORT_ICON}
              onChange={(value) => onConfigOptionChange(effortOption.id, value)}
            />
          ) : null}
          {modelOption ? (
            <ConfigOptionSelect
              option={modelOption}
              searchable
              onChange={(value) => onConfigOptionChange(modelOption.id, value)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ChatInput
