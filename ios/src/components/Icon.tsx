import { SymbolView, type SFSymbol } from 'expo-symbols'
import type { ColorValue, StyleProp, ViewStyle } from 'react-native'

/** SF Symbol on iOS; the Material Symbol twin elsewhere (web preview). */
export function Icon({ sf, md, size = 20, color, weight = 'semibold', style }: {
  sf: SFSymbol; md?: string; size?: number; color: ColorValue; weight?: 'regular' | 'medium' | 'semibold' | 'bold'; style?: StyleProp<ViewStyle>
}) {
  return (
    <SymbolView
      name={{ ios: sf, android: (md ?? 'circle') as never, web: (md ?? 'circle') as never }}
      size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
    />
  )
}
