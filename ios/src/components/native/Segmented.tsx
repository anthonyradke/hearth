import { Pressable, View } from 'react-native'
import { useTheme } from '@/theme'
import { Txt } from '../Txt'

/** Fallback for the web preview; iOS uses the system control (Segmented.ios.tsx). */
export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: 9, padding: 2, alignSelf: 'stretch' }}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={{ flex: 1, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: v === value ? c.panelRaised : 'transparent' }}>
          <Txt variant="sub" style={{ fontWeight: v === value ? '600' : '500' }}>{label}</Txt>
        </Pressable>
      ))}
    </View>
  )
}
