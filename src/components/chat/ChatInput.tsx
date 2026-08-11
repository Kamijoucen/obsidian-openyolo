import type {
  AvailableCommand,
  SessionConfigOption,
} from '@agentclientprotocol/sdk'
import { ArrowUp, FileText, Paperclip, Save, Square, X } from 'lucide-react'
import { TFile } from 'obsidian'
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { useSettings } from '../../contexts/settings-context'
import type { SessionModeState } from '../../types/chat'

import {
  type SubmitResult,
  buildComposerAttachments,
  hasComposerText,
  isAutoAttachedCurrentNote,
  settleComposerDraft,
} from './composer'
import {
  IMAGE_ATTACHMENT_LIMITS,
  type ImageAttachmentLimitReason,
  admitImageAttachments,
} from './imageAttachments'
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
  size: number
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
  onSubmit: (
    text: string,
    images: InputImage[],
    notes: AttachedNote[],
  ) => Promise<SubmitResult>
  onCancel: () => void
  savingToNote?: boolean
  onSaveToNote?: () => void
}

function createAbortError(): Error {
  const error = new Error('Image read aborted')
  error.name = 'AbortError'
  return error
}

function readImageFile(file: File, signal: AbortSignal): Promise<InputImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    let handleSignalAbort: () => void = () => undefined

    const cleanup = () => {
      signal.removeEventListener('abort', handleSignalAbort)
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
    }
    const resolveOnce = (image: InputImage) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(image)
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    handleSignalAbort = () => {
      if (reader.readyState === 1) {
        reader.abort()
      } else {
        rejectOnce(createAbortError())
      }
    }

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const match = result.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        rejectOnce(new Error('Failed to read image'))
        return
      }
      try {
        resolveOnce({
          mimeType: match[1],
          data: match[2],
          previewUrl: URL.createObjectURL(file),
          size: file.size,
        })
      } catch (error) {
        rejectOnce(
          error instanceof Error ? error : new Error('Failed to read image'),
        )
      }
    }
    reader.onerror = () => {
      rejectOnce(reader.error ?? new Error('Failed to read image'))
    }
    reader.onabort = () => rejectOnce(createAbortError())
    if (signal.aborted) {
      rejectOnce(createAbortError())
      return
    }
    signal.addEventListener('abort', handleSignalAbort, { once: true })
    reader.readAsDataURL(file)
  })
}

function revokeImagePreview(image: InputImage): void {
  URL.revokeObjectURL(image.previewUrl)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
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
  savingToNote = false,
  onSaveToNote,
}: ChatInputProps) {
  const { t } = useLanguage()
  const { settings } = useSettings()
  const [text, setText] = useState('')
  const [images, setImages] = useState<InputImage[]>([])
  const [notes, setNotes] = useState<TFile[]>([])
  const [externalFiles, setExternalFiles] = useState<AttachedNote[]>([])
  const [excludedCurrentPath, setExcludedCurrentPath] = useState<string | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const imagesRef = useRef<InputImage[]>([])
  const imageUsageRef = useRef({ count: 0, bytes: 0 })
  const pendingImageReadsRef = useRef(new Set<AbortController>())
  const activeFile = useActiveFile()

  useEffect(() => {
    mountedRef.current = true
    const pendingReads = pendingImageReadsRef.current
    return () => {
      mountedRef.current = false
      for (const controller of pendingReads) {
        controller.abort()
      }
      pendingReads.clear()
      for (const image of imagesRef.current) revokeImagePreview(image)
      imagesRef.current = []
    }
  }, [])

  const currentNote =
    settings.attachCurrentNote &&
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

  const attachedNotes = useMemo(
    () =>
      buildComposerAttachments(
        currentNote
          ? { path: currentNote.path, name: currentNote.basename }
          : null,
        notes.map((note) => ({ path: note.path, name: note.basename })),
        externalFiles,
      ),
    [currentNote, notes, externalFiles],
  )
  const canSubmit = hasComposerText(text)

  const releaseImageUsage = (image: Pick<InputImage, 'size'>) => {
    imageUsageRef.current = {
      count: Math.max(0, imageUsageRef.current.count - 1),
      bytes: Math.max(0, imageUsageRef.current.bytes - image.size),
    }
  }

  const replaceImages = (next: InputImage[]) => {
    imagesRef.current = next
    setImages(next)
  }

  const removeImage = (image: InputImage) => {
    if (!imagesRef.current.includes(image)) return
    releaseImageUsage(image)
    revokeImagePreview(image)
    replaceImages(imagesRef.current.filter((item) => item !== image))
  }

  const limitMessage = (reason: ImageAttachmentLimitReason): string => {
    switch (reason) {
      case 'file_too_large':
        return t(
          'chat.imageTooLarge',
          `Each image must be ${IMAGE_ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024} MiB or smaller.`,
        )
      case 'count_limit':
        return t(
          'chat.imageCountLimit',
          `You can attach up to ${IMAGE_ATTACHMENT_LIMITS.maxCount} images.`,
        )
      case 'total_size_limit':
        return t(
          'chat.imageTotalLimit',
          `Image attachments can total up to ${IMAGE_ATTACHMENT_LIMITS.maxTotalBytes / 1024 / 1024} MiB.`,
        )
    }
  }

  const queueImageFiles = (files: readonly File[]) => {
    if (files.length === 0) return
    setAttachmentError(null)
    const admission = admitImageAttachments(
      files,
      imageUsageRef.current.count,
      imageUsageRef.current.bytes,
    )
    const rejectionMessages = [
      ...new Set(admission.rejected.map(({ reason }) => limitMessage(reason))),
    ]
    if (rejectionMessages.length > 0) {
      setAttachmentError(rejectionMessages.join(' '))
    }

    for (const file of admission.accepted) {
      imageUsageRef.current = {
        count: imageUsageRef.current.count + 1,
        bytes: imageUsageRef.current.bytes + file.size,
      }
      const controller = new AbortController()
      pendingImageReadsRef.current.add(controller)
      void readImageFile(file, controller.signal)
        .then((image) => {
          if (!mountedRef.current || controller.signal.aborted) {
            revokeImagePreview(image)
            releaseImageUsage(image)
            return
          }
          replaceImages([...imagesRef.current, image])
        })
        .catch((error: unknown) => {
          releaseImageUsage({ size: file.size })
          if (mountedRef.current && !isAbortError(error)) {
            setAttachmentError(
              t('chat.imageReadFailed', 'Could not read the selected image.'),
            )
          }
        })
        .finally(() => {
          pendingImageReadsRef.current.delete(controller)
        })
    }
  }

  const toggleNote = (file: TFile) => {
    if (
      isAutoAttachedCurrentNote(
        settings.attachCurrentNote,
        activeFile?.path ?? null,
        file.path,
      )
    ) {
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

  const doSubmit = async () => {
    const trimmed = text.trim()
    if (
      running ||
      disabled ||
      submittingRef.current ||
      !hasComposerText(trimmed)
    ) {
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    const draft = {
      text,
      images,
      notes,
      externalFiles,
      excludedCurrentPath,
    }
    try {
      const result = await onSubmit(trimmed, images, attachedNotes)
      if (!mountedRef.current) return
      const settled = settleComposerDraft(draft, result)
      if (settled !== draft) {
        for (const image of draft.images) {
          releaseImageUsage(image)
          revokeImagePreview(image)
        }
        const remainingImages = imagesRef.current.filter(
          (image) => !draft.images.includes(image),
        )
        imagesRef.current = remainingImages
        setText((current) => (current === draft.text ? settled.text : current))
        setImages(remainingImages)
        setExcludedCurrentPath(settled.excludedCurrentPath)
      }
    } catch {
      // A rejected submission has failed; leave the draft intact for retry.
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
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
      void doSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault()
      queueImageFiles(imageFiles)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const selectedFiles = Array.from(files)
    queueImageFiles(
      selectedFiles.filter((file) => file.type.startsWith('image/')),
    )
    for (const file of selectedFiles) {
      if (file.type.startsWith('image/')) continue
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
                role="menuitem"
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
                    disabled={disabled || submitting}
                    aria-label={`${t('chat.removeAttachment', 'Remove attachment')}: ${currentNote.basename}`}
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
                    disabled={disabled || submitting}
                    aria-label={`${t('chat.removeAttachment', 'Remove attachment')}: ${note.basename}`}
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
                    disabled={disabled || submitting}
                    aria-label={`${t('chat.removeAttachment', 'Remove attachment')}: ${file.name}`}
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
                <div key={image.previewUrl} className="yolo-acp-input-image">
                  <img
                    src={image.previewUrl}
                    alt={`${t('chat.attachedImage', 'Attached image')} ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="yolo-acp-input-image-remove"
                    disabled={disabled || submitting}
                    aria-label={`${t('chat.removeImage', 'Remove image')} ${index + 1}`}
                    onClick={() => removeImage(image)}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {attachmentError ? (
            <div className="yolo-acp-attachment-error" role="alert">
              {attachmentError}
            </div>
          ) : null}
          <div className="yolo-chat-user-input-editor">
            <textarea
              ref={textareaRef}
              className="yolo-acp-textarea"
              placeholder={t('chat.inputPlaceholder', 'Ask anything…')}
              aria-label={t('chat.inputPlaceholder', 'Ask anything…')}
              aria-haspopup={matchedCommands.length > 0 ? 'menu' : undefined}
              aria-expanded={matchedCommands.length > 0}
              value={text}
              rows={1}
              disabled={disabled || submitting}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
          <div className="yolo-chat-user-input-send-row">
            <NotePicker
              selected={selectedNotePaths}
              disabled={disabled || submitting}
              onToggle={toggleNote}
              onPickFile={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              multiple
              disabled={disabled || submitting}
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
                  aria-label={t('chat.stopGenerating', 'Stop')}
                  onClick={onCancel}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="yolo-chat-user-input-submit-button-circle"
                  title={t('common.send', 'Send')}
                  aria-label={t('common.send', 'Send')}
                  onClick={() => void doSubmit()}
                  disabled={running || disabled || submitting || !canSubmit}
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
          {onSaveToNote ? (
            <button
              type="button"
              className="yolo-chat-toolbar-icon-button"
              title={t('chat.saveToNote')}
              aria-label={t('chat.saveToNote')}
              disabled={savingToNote}
              onClick={onSaveToNote}
            >
              <Save size={14} />
            </button>
          ) : null}
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
