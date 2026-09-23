import { useState } from 'react'
import { View } from 'react-native'
import type { JournalLine } from '@/lib/api'
import { clock } from '@/lib/format'
import { mono, radius, space, useTheme } from '@/theme'
import { Tap } from './Tap'
import { Txt } from './Txt'

// Game servers stamp their own lines ("09/23/2026 19:45:04: ", "[19:45:04] "); the journal's time is shown instead.
const OWN_STAMP = /^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}:\s+|\[\d{2}:\d{2}:\d{2}\]\s+)/

/** Recent journal lines, monospaced, newest at the bottom. Warnings and errors are tinted by priority. */
export function Journal({ lines, title = 'Log' }: { lines: JournalLine[]; title?: string }) {
  const { c } = useTheme()
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(-25)
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.l }}>
        <Txt variant="sub" tone="label2">{title}</Txt>
        {lines.length > 25 && (
          <Tap feedback="opacity" onPress={() => setAll(!all)} hitSlop={10}>
            <Txt variant="sub" style={{ fontWeight: '600' }}>{all ? 'Show less' : `Show all ${lines.length}`}</Txt>
          </Tap>
        )}
      </View>
      <View style={{ backgroundColor: c.panel, borderRadius: radius.panel, borderCurve: 'continuous', padding: space.l, gap: 6 }}>
        {shown.length === 0 && <Txt variant="sub" tone="label2">No log lines.</Txt>}
        {shown.map((l, i) => (
          <Txt key={i} selectable style={[mono, { color: l.priority <= 3 ? c.neg : l.priority === 4 ? c.warn : c.label }]}>
            <Txt style={[mono, { color: c.label2 }]}>{clock(l.ts)}  </Txt>{l.message.replace(OWN_STAMP, '')}
          </Txt>
        ))}
      </View>
    </View>
  )
}
