import { SafeAreaView, StyleSheet } from 'react-native';
import { ConnectionsPage } from '@/components/ConnectionsPage';
import { Colors } from '@/constants/Colors';

export default function ConnectionsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ConnectionsPage />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
