type ImageAttachmentLimits = {
  maxCount: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const IMAGE_ATTACHMENT_LIMITS: ImageAttachmentLimits = {
  maxCount: 8,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
}

export type ImageAttachmentLimitReason =
  'file_too_large' | 'count_limit' | 'total_size_limit'

type SizedFile = {
  name: string
  size: number
}

type ImageAttachmentAdmission<TFile extends SizedFile> = {
  accepted: TFile[]
  rejected: Array<{ file: TFile; reason: ImageAttachmentLimitReason }>
}

/**
 * Reserves image slots in input order. `existing*` should include reads that
 * are still pending so two overlapping selections cannot exceed the limits.
 */
export function admitImageAttachments<TFile extends SizedFile>(
  files: readonly TFile[],
  existingCount: number,
  existingBytes: number,
  limits = IMAGE_ATTACHMENT_LIMITS,
): ImageAttachmentAdmission<TFile> {
  const accepted: TFile[] = []
  const rejected: Array<{
    file: TFile
    reason: ImageAttachmentLimitReason
  }> = []
  let count = existingCount
  let bytes = existingBytes

  for (const file of files) {
    if (file.size > limits.maxFileBytes) {
      rejected.push({ file, reason: 'file_too_large' })
      continue
    }
    if (count >= limits.maxCount) {
      rejected.push({ file, reason: 'count_limit' })
      continue
    }
    if (bytes + file.size > limits.maxTotalBytes) {
      rejected.push({ file, reason: 'total_size_limit' })
      continue
    }

    accepted.push(file)
    count += 1
    bytes += file.size
  }

  return { accepted, rejected }
}
