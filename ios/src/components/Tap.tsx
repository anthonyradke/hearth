import { useState, type ReactNode } from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import { router, type Href } from 'expo-router'
import { useTheme } from '@/theme'
import { Txt } from './Txt'

type Feedback = 'scale' | 'highlight' | 'opacity'

/** The one pressable. Feedback lands on press-in: cards and buttons scale to .97, list rows get a background
 *  highlight (never scale), bar-style text links dim. `href` pushes a route. */
export function Tap({ href, onPress, feedback = 'scale', style, children, ...rest }:
  Omit<PressableProps, 'style' | 'children'> & { href?: Href; feedback?: Feedback; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { c } = useTheme()
  const [pressed, setPressed] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => { setPressed(true); rest.onPressIn?.(e) }}
      onPressOut={(e) => { setPressed(false); rest.onPressOut?.(e) }}
      onPress={(e) => { onPress?.(e); if (href) router.push(href) }}
      style={[
        style,
        pressed && feedback === 'scale' ? { transform: [{ scale: 0.97 }] } : null,
        pressed && feedback === 'highlight' ? { backgroundColor: c.fill } : null,
        pressed && feedback === 'opacity' ? { opacity: 0.5 } : null,
      ]}>
      {children}
    </Pressable>
  )
}

/** Primary pill button in ink, the one accent. */
export function Button({ label, onPress, href, secondary, disabled, style }: { label: string; onPress?: () => void; href?: Href; secondary?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <Tap href={href} onPress={onPress} disabled={disabled}
      style={[{ height: 44, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: secondary ? c.fill : c.ink, opacity: disabled ? 0.4 : 1 }, style]}>
      <Txt variant="headline" tone={secondary ? 'label' : 'onInk'}>{label}</Txt>
    </Tap>
  )
}
