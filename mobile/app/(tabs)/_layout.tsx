import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Search, Users, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const TAB_CONFIG = [
  { name: 'index', label: 'Analyze', Icon: Search },
  { name: 'connections', label: 'Connections', Icon: Users },
  { name: 'soul', label: 'My Soul', Icon: Sparkles },
] as const;

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBarOuter, { paddingBottom: insets.bottom }]}>
      {/* Glassmorphism blur effect */}
      <BlurView
        intensity={80}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle dark overlay for contrast */}
      <View style={styles.tabBarDarkOverlay} />

      {/* Tab buttons */}
      <View style={styles.tabRow}>
        {TAB_CONFIG.map((tab, index) => {
          const focused = state.index === index;
          const { Icon } = tab;

          return (
            <TouchableOpacity
              key={tab.name}
              style={styles.tabItem}
              activeOpacity={0.7}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: state.routes[index].key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) {
                  navigation.navigate(state.routes[index].name);
                }
              }}
            >
              <Icon
                size={24}
                color="#FFFFFF"
                strokeWidth={focused ? 2 : 1.5}
                style={{ opacity: focused ? 1 : 0.5 }}
              />
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, { opacity: focused ? 1 : 0.5 }]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="connections" />
      <Tabs.Screen name="soul" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabBarDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    height: 82,
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 12,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 74,
  },
  tabLabel: {
    fontSize: 11,
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans-Light',
    letterSpacing: 0.3,
  },
});
