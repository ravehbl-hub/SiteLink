/**
 * Add / edit form for a Personnel Company, presented as a modal overlay (Deck
 * dark-first tokens, compact controls). `company` null → create mode; otherwise
 * edit mode (prefilled). name is required; contactName/phone/email are optional.
 *
 * A duplicate name returns 409 from the back end — we surface it as a friendly
 * INLINE error under the name field (t('personnelCompanies.duplicateName'))
 * rather than an alert, and clear it on any edit.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PersonnelCompany } from '@sitelink/shared';
import { ApiError } from '../../lib/api';
import { useTheme } from '../../theme/ThemeProvider';
import { Body, Button, Field, Row, SectionHeading } from '../../components/ui';
import {
  useCreatePersonnelCompany,
  useUpdatePersonnelCompany,
} from './hooks';

export function PersonnelCompanyFormModal({
  visible,
  company,
  onClose,
}: {
  visible: boolean;
  company: PersonnelCompany | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isEdit = company != null;

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  // Inline error keys: 'duplicate' (409) | 'generic' (other) | null.
  const [error, setError] = useState<'duplicate' | 'generic' | null>(null);

  // Reset / prefill whenever the modal (re)opens for a given target.
  useEffect(() => {
    if (!visible) return;
    setName(company?.name ?? '');
    setContactName(company?.contactName ?? '');
    setPhone(company?.phone ?? '');
    setEmail(company?.email ?? '');
    setError(null);
  }, [visible, company]);

  const createMut = useCreatePersonnelCompany();
  const updateMut = useUpdatePersonnelCompany();
  const busy = createMut.isPending || updateMut.isPending;

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) setError('duplicate');
    else setError('generic');
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    // Empty optional fields → null so the back end stores no value.
    const body = {
      name: trimmed,
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
    };
    if (isEdit && company) {
      updateMut.mutate({ id: company.id, body }, { onSuccess: onClose, onError });
    } else {
      createMut.mutate(body, { onSuccess: onClose, onError });
    }
  };

  const sp = (k: string) => Number(theme.tokens.spacing[k as '1']);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: sp('4') }}>
        <Pressable
          onPress={onClose}
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
            borderRadius: Number(theme.tokens.radii.md),
            padding: sp('4'),
            ...theme.elevation.sm.native,
          }}
        >
          <SectionHeading>
            {isEdit ? t('personnelCompanies.editTitle') : t('personnelCompanies.addTitle')}
          </SectionHeading>

          <ScrollView style={{ maxHeight: 420 }}>
            <Field
              label={t('personnelCompanies.name')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                if (error) setError(null);
              }}
              autoCapitalize="words"
            />
            {error === 'duplicate' ? (
              <View style={{ marginBottom: sp('2') }}>
                <Text style={{ color: theme.colors.danger, textAlign: 'auto' }}>
                  {t('personnelCompanies.duplicateName')}
                </Text>
              </View>
            ) : null}

            <Field
              label={`${t('personnelCompanies.contactName')} (${t('common.optional')})`}
              value={contactName}
              onChangeText={setContactName}
              autoCapitalize="words"
            />
            <Field
              label={`${t('personnelCompanies.phone')} (${t('common.optional')})`}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Field
              label={`${t('personnelCompanies.email')} (${t('common.optional')})`}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {error === 'generic' ? (
              <View style={{ marginBottom: sp('2') }}>
                <Body muted>{t('common.error')}</Body>
              </View>
            ) : null}
          </ScrollView>

          <Row style={{ justifyContent: 'flex-end', gap: sp('2'), marginTop: sp('2') }}>
            <View style={{ minWidth: 110 }}>
              <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
            </View>
            <View style={{ minWidth: 110 }}>
              <Button
                title={t('common.save')}
                onPress={submit}
                loading={busy}
                disabled={!name.trim()}
              />
            </View>
          </Row>
        </View>
      </View>
    </Modal>
  );
}
