-- Seed initial archetypes for all 5 categories
-- This creates a collectable card system with ~25 initial archetypes (5 per category)
-- TODO: Expand to 75-100 archetypes after initial testing

-- ============================================================================
-- CATEGORIA 1: Red Flags & Green Flags
-- ============================================================================

INSERT INTO archetypes (name, category, image_url, gradient_start, gradient_end, semantic_tags, severity_range, description_template, traits_pool, rarity) VALUES

-- RED FLAGS
('The Love Bomber', 'Red Flags & Green Flags',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Love-Bomber.jpg',
 '#1B3D00', '#0A1F00',
 ARRAY['love_bombing', 'intense', 'hot_cold', 'manipulative', 'overwhelming'],
 ARRAY[7, 10],
 'Starts {intensity}, then {pattern} - {tactic}',
 ARRAY['Intense', 'Overwhelming', 'Manipulative', 'Unpredictable', 'Charming', 'Controlling'],
 'rare'),

('The Gaslighter', 'Red Flags & Green Flags',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Gaslighter.jpg',
 '#1B3D00', '#0A1F00',
 ARRAY['gaslighting', 'manipulative', 'reality_distortion', 'defensive', 'blame_shifting'],
 ARRAY[8, 10],
 'Makes you {feeling} - {pattern}',
 ARRAY['Manipulative', 'Defensive', 'Reality-bending', 'Blame-shifting', 'Confusing'],
 'epic'),

('The Breadcrumber', 'Red Flags & Green Flags',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Breadcrumber.jpg',
 '#1B3D00', '#0A1F00',
 ARRAY['breadcrumbing', 'inconsistent', 'just_enough', 'stringing_along', 'noncommittal'],
 ARRAY[6, 9],
 '{pattern} just enough to {tactic}',
 ARRAY['Inconsistent', 'Noncommittal', 'Flaky', 'Strategic', 'Minimal effort'],
 'common'),

-- GREEN FLAGS
('The Green Flag', 'Red Flags & Green Flags',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Green-Flag.jpg',
 '#1B3D00', '#0A1F00',
 ARRAY['respectful', 'consistent', 'genuine', 'communicative', 'boundaried'],
 ARRAY[1, 3],
 '{pattern} and {quality} - {summary}',
 ARRAY['Respectful', 'Consistent', 'Genuine', 'Communicative', 'Thoughtful'],
 'rare'),

('The Respectful', 'Red Flags & Green Flags',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Respectful.jpg',
 '#1B3D00', '#0A1F00',
 ARRAY['respectful', 'boundaried', 'consent', 'considerate'],
 ARRAY[1, 4],
 'Respects {pattern} - {quality}',
 ARRAY['Respectful', 'Boundaried', 'Considerate', 'Safe', 'Trustworthy'],
 'common');

-- ============================================================================
-- CATEGORIA 2: Power Balance
-- ============================================================================

INSERT INTO archetypes (name, category, image_url, gradient_start, gradient_end, semantic_tags, severity_range, description_template, traits_pool, rarity) VALUES

('The Chaser', 'Power Balance',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Chaser.jpg',
 '#3D2000', '#1F1000',
 ARRAY['chaser', 'imbalanced', 'pursuing', 'initiator', 'effort_asymmetry'],
 ARRAY[6, 10],
 'You do all the {effort} while they {pattern}',
 ARRAY['Pursuing', 'Initiating', 'Overgiving', 'Imbalanced', 'Chasing'],
 'common'),

('The Pursued', 'Power Balance',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Pursued.jpg',
 '#3D2000', '#1F1000',
 ARRAY['pursued', 'desired', 'chased', 'power_holder'],
 ARRAY[1, 4],
 'They clearly {effort} - {pattern}',
 ARRAY['Desired', 'Sought-after', 'Pursued', 'Wanted', 'Valued'],
 'rare'),

('The Power Player', 'Power Balance',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Power-Player.jpg',
 '#3D2000', '#1F1000',
 ARRAY['power_player', 'hot_cold', 'controlling', 'dominant', 'imbalanced'],
 ARRAY[7, 10],
 'Controls {pattern} - {tactic}',
 ARRAY['Controlling', 'Dominant', 'Strategic', 'Manipulative', 'Power-hungry'],
 'epic'),

('The Balanced', 'Power Balance',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Balanced.jpg',
 '#3D2000', '#1F1000',
 ARRAY['balanced', 'equal', 'mutual', '50_50', 'reciprocal'],
 ARRAY[1, 3],
 'Mutual {effort} and {pattern}',
 ARRAY['Balanced', 'Equal', 'Mutual', 'Reciprocal', 'Fair'],
 'common'),

('The Hot-Cold Player', 'Power Balance',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Hot-Cold-Player.jpg',
 '#3D2000', '#1F1000',
 ARRAY['hot_cold', 'inconsistent', 'unpredictable', 'power_shifts'],
 ARRAY[6, 9],
 '{pattern} unpredictably - {tactic}',
 ARRAY['Unpredictable', 'Inconsistent', 'Hot-Cold', 'Power-shifting', 'Confusing'],
 'rare');

-- ============================================================================
-- CATEGORIA 3: Intentions
-- ============================================================================

INSERT INTO archetypes (name, category, image_url, gradient_start, gradient_end, semantic_tags, severity_range, description_template, traits_pool, rarity) VALUES

('The Relationship Seeker', 'Intentions',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Relationship-Seeker.jpg',
 '#001B3D', '#000A1F',
 ARRAY['genuine', 'relationship_focused', 'serious', 'long_term', 'committed'],
 ARRAY[1, 3],
 'Clearly wants {goal} - {pattern}',
 ARRAY['Genuine', 'Serious', 'Committed', 'Long-term focused', 'Relationship-oriented'],
 'rare'),

('The Ego Booster', 'Intentions',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Ego-Booster.jpg',
 '#001B3D', '#000A1F',
 ARRAY['validation_seeking', 'ego_boost', 'attention', 'narcissistic'],
 ARRAY[7, 10],
 'Just wants {goal} - {pattern}',
 ARRAY['Validation-seeking', 'Attention-hungry', 'Ego-driven', 'Narcissistic', 'Self-centered'],
 'common'),

('The Time Passer', 'Intentions',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Time-Passer.jpg',
 '#001B3D', '#000A1F',
 ARRAY['time_passer', 'bored', 'not_serious', 'casual', 'killing_time'],
 ARRAY[5, 8],
 '{pattern} to kill time - {quality}',
 ARRAY['Bored', 'Casual', 'Not serious', 'Time-passing', 'Uncommitted'],
 'common'),

('The Hookup Hunter', 'Intentions',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Hookup-Hunter.jpg',
 '#001B3D', '#000A1F',
 ARRAY['hookup_focused', 'sexual', 'physical', 'not_relationship'],
 ARRAY[6, 9],
 'Only interested in {goal} - {pattern}',
 ARRAY['Sexual', 'Physical', 'Hookup-focused', 'Non-committal', 'Short-term'],
 'rare'),

('The Confused', 'Intentions',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Confused.jpg',
 '#001B3D', '#000A1F',
 ARRAY['confused', 'unclear', 'mixed_signals', 'uncertain', 'indecisive'],
 ARRAY[4, 7],
 '{pattern} about what they want - {quality}',
 ARRAY['Confused', 'Uncertain', 'Mixed signals', 'Indecisive', 'Unclear'],
 'common');

-- ============================================================================
-- CATEGORIA 4: Chemistry
-- ============================================================================

INSERT INTO archetypes (name, category, image_url, gradient_start, gradient_end, semantic_tags, severity_range, description_template, traits_pool, rarity) VALUES

('The Electric Connection', 'Chemistry',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Electric-Connection.jpg',
 '#003D3D', '#001F1F',
 ARRAY['electric', 'spark', 'chemistry', 'natural', 'flowing'],
 ARRAY[8, 10],
 '{intensity} chemistry - {pattern}',
 ARRAY['Electric', 'Natural', 'Flowing', 'Spark', 'Magnetic'],
 'rare'),

('The Flatline', 'Chemistry',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Flatline.jpg',
 '#003D3D', '#001F1F',
 ARRAY['flat', 'no_spark', 'forced', 'awkward', 'disconnect'],
 ARRAY[1, 3],
 '{pattern} - {quality}',
 ARRAY['Flat', 'Forced', 'Awkward', 'Disconnected', 'No spark'],
 'common'),

('The One-Sided Spark', 'Chemistry',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-One-Sided-Spark.jpg',
 '#003D3D', '#001F1F',
 ARRAY['one_sided', 'unreciprocated', 'imbalanced_chemistry', 'you_feel_it'],
 ARRAY[5, 8],
 'You feel {feeling} but they {pattern}',
 ARRAY['One-sided', 'Unreciprocated', 'Imbalanced', 'Unreturned', 'Asymmetric'],
 'common'),

('The Slow Burn', 'Chemistry',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Slow-Burn.jpg',
 '#003D3D', '#001F1F',
 ARRAY['slow_burn', 'building', 'gradual', 'developing'],
 ARRAY[4, 7],
 '{pattern} gradually - {quality}',
 ARRAY['Building', 'Gradual', 'Developing', 'Growing', 'Slow-burn'],
 'rare'),

('The Forced Connection', 'Chemistry',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Forced-Connection.jpg',
 '#003D3D', '#001F1F',
 ARRAY['forced', 'trying_too_hard', 'unnatural', 'awkward'],
 ARRAY[3, 6],
 'Feels {quality} - {pattern}',
 ARRAY['Forced', 'Trying too hard', 'Unnatural', 'Strained', 'Awkward'],
 'common');

-- ============================================================================
-- CATEGORIA 5: Investment
-- ============================================================================

INSERT INTO archetypes (name, category, image_url, gradient_start, gradient_end, semantic_tags, severity_range, description_template, traits_pool, rarity) VALUES

('The High Effort', 'Investment',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-High-Effort.jpg',
 '#3D001B', '#1F000A',
 ARRAY['high_effort', 'invested', 'thoughtful', 'quality_messages', 'engaged'],
 ARRAY[8, 10],
 '{effort} with {pattern} - {quality}',
 ARRAY['Invested', 'Thoughtful', 'Engaged', 'Quality', 'Effort-giving'],
 'rare'),

('The Bare Minimum', 'Investment',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Bare-Minimum.jpg',
 '#3D001B', '#1F000A',
 ARRAY['bare_minimum', 'low_effort', 'one_word', 'disengaged', 'lazy'],
 ARRAY[7, 10],
 '{pattern} and {effort} - {quality}',
 ARRAY['Low-effort', 'One-word replies', 'Disengaged', 'Lazy', 'Minimal'],
 'common'),

('The Inconsistent', 'Investment',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Inconsistent.jpg',
 '#3D001B', '#1F000A',
 ARRAY['inconsistent', 'hot_cold_effort', 'unpredictable', 'variable'],
 ARRAY[5, 8],
 'Sometimes {pattern} then {opposite}',
 ARRAY['Inconsistent', 'Unpredictable', 'Variable', 'Hot-cold', 'Erratic'],
 'common'),

('The Matcher', 'Investment',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Matcher.jpg',
 '#3D001B', '#1F000A',
 ARRAY['matcher', 'mirrors', 'reciprocal', 'balanced_effort'],
 ARRAY[4, 7],
 'Mirrors {pattern} - {quality}',
 ARRAY['Matching', 'Reciprocal', 'Balanced', 'Mirror', 'Equal-effort'],
 'rare'),

('The Ghost', 'Investment',
 'http://127.0.0.1:54321/storage/v1/object/public/archetypes/The-Ghost.jpg',
 '#3D001B', '#1F000A',
 ARRAY['ghost', 'disappearing', 'no_response', 'vanishing', 'unreliable'],
 ARRAY[8, 10],
 '{pattern} completely - {quality}',
 ARRAY['Ghosting', 'Disappearing', 'Unreliable', 'Vanishing', 'No response'],
 'epic');

-- Verify the insert
SELECT category, COUNT(*) as archetype_count
FROM archetypes
GROUP BY category
ORDER BY category;
