import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { MessageSquarePlus, Plus, X } from 'lucide-react-native';
import { Colors, Fonts } from '@/constants/Colors';
import { startAnalysis, type ImageFile } from '@/services/analysisService';
import { injectContentScenario } from '@/services/contentModeService';
import type { ContentScenario } from '@/types/contentScenario';

const MAX_SCREENSHOTS = 10;

type Gender = 'his' | 'her';

interface SelectedImage {
  uri: string;
  name: string;
  type: string;
}

interface UploadPageProps {
  contentScenario?: ContentScenario | null;
}

const HORIZONTAL_PADDING = 32;

export function UploadPage({ contentScenario }: UploadPageProps) {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - HORIZONTAL_PADDING * 2;

  // Image selection state
  const [images, setImages] = useState<SelectedImage[]>([]);

  // Gender selection
  const [gender, setGender] = useState<Gender>('his');

  // Name input
  const [personName, setPersonName] = useState('');

  // Loading state
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Content mode
  const isContentMode = !!contentScenario;

  // Pulse animation for the upload zone
  const pulseOpacity = useSharedValue(0.5);

  useEffect(() => {
    pulseOpacity.value = withRepeat(
      withTiming(0.8, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  // Content mode: auto-load scenario on mount
  useEffect(() => {
    if (isContentMode && contentScenario) {
      // For content mode, we skip image picking entirely
      // The scenario already has all the data baked in
      handleContentModeAnalyze();
    }
  }, [contentScenario]);

  async function handleContentModeAnalyze() {
    if (!contentScenario) return;
    setIsAnalyzing(true);
    try {
      const analysisId = await injectContentScenario(contentScenario);
      router.push(`/results/${analysisId}`);
    } catch (error) {
      console.error('[ContentMode] Error injecting scenario:', error);
      Alert.alert('Error', 'Failed to load content scenario.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  const pickImages = useCallback(async () => {
    const remainingSlots = MAX_SCREENSHOTS - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', `Maximum ${MAX_SCREENSHOTS} screenshots allowed per analysis.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      const newImages: SelectedImage[] = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName || `screenshot_${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      }));

      setImages((prev) => [...prev, ...newImages].slice(0, MAX_SCREENSHOTS));
    }
  }, [images.length]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  async function handleAnalyze() {
    if (images.length === 0) {
      Alert.alert('No Screenshots', 'Please upload at least one chat screenshot.');
      return;
    }

    setIsAnalyzing(true);

    try {
      // Build ImageFile array for the analysis service
      const imageFiles: ImageFile[] = images.map((img) => ({
        uri: img.uri,
        name: img.name,
        type: img.type,
      }));

      // Use a dev person ID (the mobile app uses a simplified first-time flow)
      const personId = 'dev-person-' + Date.now();

      const analysisId = await startAnalysis(personId, imageFiles);
      console.log('[UploadPage] Analysis started, navigating to results:', analysisId);

      router.push(`/results/${analysisId}`);
    } catch (error) {
      console.error('[UploadPage] Analysis failed:', error);
      Alert.alert(
        'Analysis Failed',
        error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      );
      setIsAnalyzing(false);
    }
  }

  const displayName = personName.trim() || (gender === 'his' ? 'Him' : 'Her');
  const hasImages = images.length > 0;
  const canAnalyze = hasImages && !isAnalyzing;

  // Loading overlay
  if (isAnalyzing) {
    return (
      <View style={styles.loadingContainer}>
        <Animated.View entering={FadeIn.duration(400)} style={styles.loadingContent}>
          <ActivityIndicator size="large" color="#7C4DFF" />
          <Text style={styles.loadingTitle}>Analyzing...</Text>
          <Text style={styles.loadingSubtitle}>
            Reading between the lines
          </Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ width: contentWidth, alignSelf: 'center' }}>
        {/* Upload Zone */}
        <Animated.View entering={FadeInDown.duration(500).delay(100)}>
          <TouchableOpacity
            style={styles.uploadZone}
            onPress={pickImages}
            activeOpacity={0.7}
          >
            {!hasImages ? (
              <View style={styles.uploadEmpty}>
                <Animated.View style={pulseStyle}>
                  <MessageSquarePlus
                    size={56}
                    color="rgba(255, 255, 255, 0.35)"
                    strokeWidth={1.2}
                  />
                </Animated.View>
                <Text style={styles.uploadTitle}>Upload your chats</Text>
                <Text style={styles.uploadSubtitle}>
                  {'You can choose to upload 1 or\nmore chat screenshots'}
                </Text>
              </View>
            ) : (
              <View style={styles.uploadFilled}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbnailRow}
                >
                  {images.map((img, index) => (
                    <Animated.View
                      key={img.uri}
                      entering={FadeIn.duration(300).delay(index * 50)}
                      style={styles.thumbnailContainer}
                    >
                      <Image source={{ uri: img.uri }} style={styles.thumbnail} />
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => removeImage(index)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <X size={12} color="#FFFFFF" strokeWidth={2.5} />
                      </TouchableOpacity>
                    </Animated.View>
                  ))}

                  {/* Add more button */}
                  {images.length < MAX_SCREENSHOTS && (
                    <TouchableOpacity
                      style={styles.addMoreThumbnail}
                      onPress={pickImages}
                      activeOpacity={0.6}
                    >
                      <Plus size={24} color="rgba(255, 255, 255, 0.4)" strokeWidth={1.5} />
                    </TouchableOpacity>
                  )}
                </ScrollView>
                <Text style={styles.uploadCount}>
                  {images.length} chat{images.length > 1 ? 's' : ''} uploaded
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Gender Selection */}
        <Animated.View entering={FadeInDown.duration(500).delay(200)}>
          <Text style={styles.sectionLabel}>Analyze from perspective of:</Text>
          <View style={styles.genderRow}>
            <TouchableOpacity
              style={[
                styles.genderButton,
                gender === 'his' && styles.genderButtonActive,
              ]}
              onPress={() => setGender('his')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.genderText,
                  gender === 'his' && styles.genderTextActive,
                ]}
              >
                His
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.genderButton,
                gender === 'her' && styles.genderButtonActive,
              ]}
              onPress={() => setGender('her')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.genderText,
                  gender === 'her' && styles.genderTextActive,
                ]}
              >
                Her
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Name Input */}
        <Animated.View entering={FadeInDown.duration(500).delay(300)}>
          <Text style={styles.sectionLabel}>
            Name <Text style={styles.optionalLabel}>(optional)</Text>
          </Text>
          <TextInput
            style={styles.nameInput}
            placeholder={gender === 'his' ? 'Him' : 'Her'}
            placeholderTextColor="rgba(255, 255, 255, 0.25)"
            value={personName}
            onChangeText={setPersonName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            maxLength={30}
          />
        </Animated.View>

        {/* Analyze Button */}
        <Animated.View entering={FadeInUp.duration(500).delay(400)}>
          <TouchableOpacity
            onPress={handleAnalyze}
            disabled={!canAnalyze}
            activeOpacity={0.8}
            style={{ marginTop: 32 }}
          >
            <LinearGradient
              colors={canAnalyze ? ['#7200B4', '#7200B4'] : ['#333333', '#222222']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.analyzeButton,
                !canAnalyze && styles.analyzeButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.analyzeButtonText,
                  !canAnalyze && styles.analyzeButtonTextDisabled,
                ]}
              >
                ANALYZE
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 40,
  },
  // Upload Zone
  uploadZone: {
    backgroundColor: '#1A1A1A',
    borderRadius: 28,
    width: '100%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    overflow: 'hidden',
  },
  uploadEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  uploadTitle: {
    color: Colors.white,
    fontSize: 18,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 8,
  },
  uploadSubtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    textAlign: 'center',
    lineHeight: 22,
  },
  uploadFilled: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  thumbnailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  thumbnailContainer: {
    position: 'relative',
  },
  thumbnail: {
    width: 80,
    height: 140,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreThumbnail: {
    width: 80,
    height: 140,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCount: {
    color: Colors.textMuted,
    fontSize: 13,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginTop: 16,
  },
  // Gender Selection
  sectionLabel: {
    color: Colors.white,
    fontSize: 15,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  optionalLabel: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  genderButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  genderButtonActive: {
    borderColor: '#7C4DFF',
    backgroundColor: 'rgba(124, 77, 255, 0.12)',
  },
  genderText: {
    color: Colors.textMuted,
    fontSize: 15,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
  },
  genderTextActive: {
    color: '#FFFFFF',
  },
  // Name Input
  nameInput: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    color: Colors.white,
    fontSize: 15,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
  },
  // Analyze Button
  analyzeButton: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzeButtonDisabled: {
    opacity: 0.5,
  },
  analyzeButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontFamily: Fonts.jakarta.regular,
    fontWeight: '500',
    letterSpacing: 2,
  },
  analyzeButtonTextDisabled: {
    opacity: 0.6,
  },
  // Loading
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    gap: 16,
  },
  loadingTitle: {
    color: Colors.white,
    fontSize: 22,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginTop: 8,
  },
  loadingSubtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },
});
