/**
 * Site PICKER (Foreman MULTI-SITE). A compact header/inline control that shows the
 * active site and — when the foreman has more than one pickable site — opens a modal
 * list to switch. Drives `ActiveSiteProvider.activeSiteId`, which every scoped screen
 * reads. All color/space/radius from @sitelink/tokens (DESIGN.md — no hex/size);
 * directional layout uses logical `marginStart/End` for RTL.
 *
 * RENDER CASES
 *   - Empty union  → renders nothing (the screens themselves show "no site assigned").
 *   - Single site  → a READ-ONLY pill (no chevron, not pressable) — no pointless menu.
 *   - Multi-site   → a pressable pill (chevron) that opens the modal selection list.
 */
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { useActiveSite } from './ActiveSiteProvider';

export function SitePicker() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { sites, activeSite, activeSiteId, setActiveSiteId } = useActiveSite();
  const [open, setOpen] = useState(false);

  // Empty union → nothing to pick; the screen renders the no-site state.
  if (sites.length === 0) return null;

  const multi = sites.length > 1;
  const label = activeSite?.name ?? t('site.select');

  const pill = (
    // Active-site chip is a "data/active" element on the Deck: teal-tinted ground,
    // teal accent border and a soft teal glow.
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.accentSubtle,
        borderColor: theme.colors.accent,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.tokens.radii.pill ?? 999),
        paddingVertical: Number(theme.tokens.spacingCompact['2']),
        paddingHorizontal: Number(theme.tokens.spacingCompact['3']),
        shadowColor: theme.glow.accent.color,
        shadowOpacity: 0.25,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      }}
    >
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: Number(theme.tokens.fontSize.sm ?? 14),
          marginEnd: Number(theme.tokens.spacing['1']),
        }}
      >
        {t('site.label')}
      </Text>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: Number(theme.tokens.fontSize.sm ?? 14),
          fontWeight: '600',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {multi ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            marginStart: Number(theme.tokens.spacing['2']),
          }}
        >
          ▾
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ marginBottom: Number(theme.tokens.spacing['3']) }}>
      {multi ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('site.select')}
          onPress={() => setOpen(true)}
          // Compact pill trigger, but preserve a ~44px accessible tap area.
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          {pill}
        </Pressable>
      ) : (
        // Single site → read-only indicator (not interactive).
        <View accessibilityRole="text" accessibilityLabel={label}>
          {pill}
        </View>
      )}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: Number(theme.tokens.spacing['4']),
          }}
        >
          {/* Dim scrim (tap to dismiss). Sibling behind the sheet so the sheet stays
              fully opaque; scrim color derived from a token, no color literal. */}
          <Pressable
            onPress={() => setOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.colors.textPrimary,
              opacity: 0.4,
            }}
          />
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
              // Neumorphic modal: softer cardLg radius + a raised drop-shadow.
              borderRadius: Number(theme.neumorphic?.radii.cardLg ?? theme.tokens.radii.md),
              padding: Number(theme.tokens.spacing['4']),
              ...theme.elevation.lg.native,
            }}
          >
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: Number(theme.tokens.fontSize.sm ?? 14),
                fontWeight: '600',
                marginBottom: Number(theme.tokens.spacing['2']),
                textAlign: 'auto',
              }}
            >
              {t('site.select')}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {sites.map((s) => {
                const active = s.siteId === activeSiteId;
                return (
                  <Pressable
                    key={s.siteId}
                    onPress={() => {
                      setActiveSiteId(s.siteId);
                      setOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: active ? theme.colors.accentSubtle : 'transparent',
                      borderRadius: Number(theme.tokens.radii.sm),
                      paddingVertical: Number(theme.tokens.spacing['3']),
                      paddingHorizontal: Number(theme.tokens.spacing['3']),
                      marginBottom: Number(theme.tokens.spacing['1']),
                    }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Text
                        style={{
                          color: active ? theme.colors.accent : theme.colors.textPrimary,
                          fontWeight: active ? '700' : '500',
                          textAlign: 'auto',
                        }}
                        numberOfLines={1}
                      >
                        {s.name}
                      </Text>
                      {s.isPrimary ? (
                        <Text
                          style={{
                            color: theme.colors.textMuted,
                            fontSize: Number(theme.tokens.fontSize.xs ?? 12),
                            textAlign: 'auto',
                          }}
                        >
                          {t('site.primary')}
                        </Text>
                      ) : null}
                    </View>
                    {active ? (
                      <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
