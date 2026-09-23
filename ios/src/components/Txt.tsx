import { Text, type TextProps } from 'react-native'
import { tabular, font as ramp, useTheme } from '@/theme'

type Role = keyof typeof ramp
type Tone = 'label' | 'label2' | 'label3' | 'pos' | 'neg' | 'warn' | 'ink' | 'onInk'

/** Text with a role from the type ramp and a tone from the palette. `num` switches on tabular figures. */
export function Txt({ variant = 'body', tone = 'label', num, style, ...rest }: TextProps & { variant?: Role; tone?: Tone; num?: boolean }) {
  const { c } = useTheme()
  return <Text maxFontSizeMultiplier={1.6} {...rest} style={[ramp[variant], { color: c[tone] }, num && tabular, style]} />
}
