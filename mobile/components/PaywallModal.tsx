import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock, X, Zap, Crown } from 'lucide-react-native';
import { Colors, Fonts } from '@/constants/Colors';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscribe?: (plan: 'annual' | 'monthly') => void;
  onSingleUnlock?: () => void;
  canUseSingleUnlock?: boolean;
  singleUnlocksRemaining?: number;
  isFirstAnalysis?: boolean;
  archetypeImage?: string;
}

export function PaywallModal({
  isOpen,
  onClose,
  onSubscribe,
  onSingleUnlock,
  canUseSingleUnlock = true,
  singleUnlocksRemaining = 2,
  isFirstAnalysis = false,
}: PaywallModalProps) {
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Close button */}
          <Pressable style={styles.closeButton} onPress={onClose}>
            <X size={24} color={Colors.textMuted} />
          </Pressable>

          {/* Header */}
          <View style={styles.header}>
            <Crown size={40} color="#FCD34D" />
            <Text style={styles.title}>Unlock Full Analysis</Text>
            <Text style={styles.subtitle}>
              See all message insights, category breakdowns, and your Soul Type dynamic
            </Text>
          </View>

          {/* Plans */}
          <View style={styles.plans}>
            {/* Annual */}
            <Pressable
              style={styles.planCard}
              onPress={() => onSubscribe?.('annual')}
            >
              <LinearGradient
                colors={['rgba(139, 92, 246, 0.3)', 'rgba(139, 92, 246, 0.1)']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>BEST VALUE</Text>
              </View>
              <Text style={styles.planName}>Annual</Text>
              <Text style={styles.planPrice}>$4.99/mo</Text>
              <Text style={styles.planBilled}>Billed $59.99/year</Text>
            </Pressable>

            {/* Monthly */}
            <Pressable
              style={[styles.planCard, styles.planCardSecondary]}
              onPress={() => onSubscribe?.('monthly')}
            >
              <Text style={styles.planName}>Monthly</Text>
              <Text style={styles.planPrice}>$9.99/mo</Text>
              <Text style={styles.planBilled}>Cancel anytime</Text>
            </Pressable>
          </View>

          {/* Single Unlock */}
          {canUseSingleUnlock && (
            <Pressable
              style={styles.singleUnlock}
              onPress={onSingleUnlock}
            >
              <Zap size={16} color={Colors.decoded} />
              <Text style={styles.singleUnlockText}>
                One-time unlock · $2.99 ({singleUnlocksRemaining} left this month)
              </Text>
            </Pressable>
          )}

          {/* Note: Will be replaced with RevenueCat in-app purchases */}
          <Text style={styles.note}>
            In-app purchases coming soon
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontFamily: Fonts.outfit.semiBold,
    color: Colors.textPrimary,
    letterSpacing: 1,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.jakarta.light,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  plans: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(139, 92, 246, 0.5)',
    padding: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  planCardSecondary: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  planBadge: {
    backgroundColor: '#7200B4',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  planBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.outfit.semiBold,
    color: Colors.textPrimary,
    letterSpacing: 1,
  },
  planName: {
    fontSize: 16,
    fontFamily: Fonts.outfit.medium,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  planPrice: {
    fontSize: 22,
    fontFamily: Fonts.outfit.bold,
    color: Colors.textPrimary,
  },
  planBilled: {
    fontSize: 12,
    fontFamily: Fonts.jakarta.light,
    color: Colors.textMuted,
    marginTop: 4,
  },
  singleUnlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  singleUnlockText: {
    fontSize: 14,
    fontFamily: Fonts.jakarta.regular,
    color: Colors.textSecondary,
  },
  note: {
    fontSize: 12,
    fontFamily: Fonts.jakarta.light,
    color: Colors.textDim,
    textAlign: 'center',
  },
});
