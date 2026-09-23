import { DynamicColorIOS } from 'react-native'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useOverview } from '@/lib/data'

// Tabs are peers: each keeps its own stack, and re-tapping the active tab pops to its root. The bar is the system's
// Liquid Glass bar; ink is the selected color. Overview carries a badge with the number of open issues.
const ink = process.env.EXPO_OS === 'ios' ? DynamicColorIOS({ light: '#000000', dark: '#FFFFFF' }) : undefined

export default function TabLayout() {
  const issues = useOverview().data?.status.issues.length ?? 0
  return (
    <NativeTabs tintColor={ink} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(overview)">
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="dashboard" />
        {issues > 0 && <NativeTabs.Trigger.Badge>{String(issues)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(services)">
        <NativeTabs.Trigger.Label>Services</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'server.rack', selected: 'server.rack' }} md="dns" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(games)">
        <NativeTabs.Trigger.Label>Games</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gamecontroller', selected: 'gamecontroller.fill' }} md="sports_esports" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(activity)">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} md="history" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
