import type { YoloSettings } from './schema/setting.types'

type ConnectionSettings = Pick<YoloSettings, 'opencodePath' | 'opencodeArgs'>

export function sameConnectionSettings(
  left: ConnectionSettings,
  right: ConnectionSettings,
): boolean {
  return (
    left.opencodePath === right.opencodePath &&
    left.opencodeArgs.length === right.opencodeArgs.length &&
    left.opencodeArgs.every(
      (argument, index) => argument === right.opencodeArgs[index],
    )
  )
}
