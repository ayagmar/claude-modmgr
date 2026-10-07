// The band above the prompt (PLAN §5.4, C8): one line while something is
// actionable and wasn't dismissed. Letters only (a bare digit in an empty
// composer presses a band Button, F12). Undefined: the band passes.

import type { RenderElement } from 'claude-code'
import { bandOf, summaryOf } from '../domain/view.ts'
import { KeyButton, TONE, type ViewPorts } from './kit.tsx'

export const drawBand = async (
  v: ViewPorts,
  props: { readonly hasSurvey: boolean; readonly isWorking: boolean },
): Promise<RenderElement | undefined> => {
  if (props.hasSurvey) return undefined
  const [attention, queue, mods] = await Promise.all([
    v.read('attention'),
    v.read('queue'),
    v.read('mods'),
  ])
  // The same summary the status line and the pane title are drawn from.
  const band = bandOf(summaryOf({ attention, queue, mods }), {
    dismissed: attention.dismissed,
    isWorking: props.isWorking,
  })
  if (band === undefined) return undefined
  const { Box, Text } = v.el
  return (
    <Box flexDirection="row" gap={2}>
      <Text color={TONE.accent} wrap="truncate-end">
        {band.text}
      </Text>
      {KeyButton(v, {
        action: 'open-modmgr',
        on: 'band',
        label: 'open',
        onPress: () => v.act.openPane(),
      })}
      {band.reload
        ? KeyButton(v, {
            action: 'reload',
            on: 'band',
            label: 'reload',
            onPress: () => v.act.reload(),
          })
        : null}
      {KeyButton(v, {
        action: 'dismiss',
        on: 'band',
        label: 'dismiss',
        onPress: () => v.act.dismiss(band.key),
      })}
    </Box>
  )
}
