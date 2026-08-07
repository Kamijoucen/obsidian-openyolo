import {
  IMAGE_ATTACHMENT_LIMITS,
  admitImageAttachments,
} from './imageAttachments'

const image = (name: string, size: number) => ({ name, size })

describe('admitImageAttachments', () => {
  it('rejects an image that exceeds the per-file limit', () => {
    const tooLarge = image(
      'large.png',
      IMAGE_ATTACHMENT_LIMITS.maxFileBytes + 1,
    )

    expect(admitImageAttachments([tooLarge], 0, 0)).toEqual({
      accepted: [],
      rejected: [{ file: tooLarge, reason: 'file_too_large' }],
    })
  })

  it('includes pending reservations when enforcing count and total limits', () => {
    const first = image('first.png', 2)
    const second = image('second.png', 2)
    const limits = { maxCount: 2, maxFileBytes: 10, maxTotalBytes: 3 }

    expect(admitImageAttachments([first, second], 1, 1, limits)).toEqual({
      accepted: [first],
      rejected: [{ file: second, reason: 'count_limit' }],
    })
  })

  it('accepts files only while the aggregate byte budget remains available', () => {
    const first = image('first.png', 3)
    const second = image('second.png', 3)
    const limits = { maxCount: 8, maxFileBytes: 10, maxTotalBytes: 5 }

    expect(admitImageAttachments([first, second], 0, 0, limits)).toEqual({
      accepted: [first],
      rejected: [{ file: second, reason: 'total_size_limit' }],
    })
  })
})
