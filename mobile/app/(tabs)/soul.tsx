import { SafeAreaView, StyleSheet } from 'react-native';
import { SoulPage } from '@/components/SoulPage';
import { Colors } from '@/constants/Colors';

export default function SoulScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <SoulPage />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
