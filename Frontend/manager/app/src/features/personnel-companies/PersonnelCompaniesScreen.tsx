/**
 * Personnel Companies (FR-MGR-EMP-2) — MANAGEMENT screen. A scrollable list of
 * org-wide staffing companies (name + contact + archived badge), with:
 *   - "Add company" → the form modal (create),
 *   - per-row Edit → the form modal (edit),
 *   - per-row Archive / Unarchive toggle,
 *   - an "include archived" Segmented filter.
 *
 * Operations Deck dark-first tokens only. RTL: text primitives are textAlign:'auto'
 * and layout uses logical marginStart/End (no hard-coded left/right). Compact
 * controls (Button / Segmented) carry a ~44px accessible tap area via hitSlop.
 *
 * NOTE: the worker-form personnelCompany PICKER is a separate later item and is
 * intentionally NOT built here.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PersonnelCompany } from '@sitelink/shared';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';
import { PersonnelCompanyFormModal } from './PersonnelCompanyFormModal';
import {
  useArchivePersonnelCompany,
  useDeletePersonnelCompany,
  usePersonnelCompanies,
} from './hooks';

export function PersonnelCompaniesScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<PersonnelCompany | null>(null);

  const q = usePersonnelCompanies(includeArchived);
  const archiveMut = useArchivePersonnelCompany();
  const deleteMut = useDeletePersonnelCompany();

  const openAdd = () => {
    setEditTarget(null);
    setFormVisible(true);
  };
  const openEdit = (c: PersonnelCompany) => {
    setEditTarget(c);
    setFormVisible(true);
  };

  const toggleArchive = (c: PersonnelCompany) => {
    const archiving = !c.isArchived;
    Alert.alert(
      archiving
        ? t('personnelCompanies.archiveConfirm')
        : t('personnelCompanies.unarchiveConfirm'),
      c.name,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: archiving ? t('common.archive') : t('personnelCompanies.unarchive'),
          style: archiving ? 'destructive' : 'default',
          onPress: () =>
            archiveMut.mutate(
              { id: c.id, archived: c.isArchived },
              {
                onError: () => Alert.alert(t('common.error')),
              },
            ),
        },
      ],
    );
  };

  const confirmRemove = (c: PersonnelCompany) => {
    Alert.alert(t('personnelCompanies.confirmRemove'), c.name, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('personnelCompanies.remove'),
        style: 'destructive',
        onPress: () =>
          deleteMut.mutate(c.id, {
            onError: () => Alert.alert(t('common.error')),
          }),
      },
    ]);
  };

  const contactLine = (c: PersonnelCompany): string => {
    const parts = [c.contactName, c.phone, c.email].filter(Boolean) as string[];
    return parts.length ? parts.join(' · ') : '—';
  };

  return (
    <Screen>
      <Title>{t('personnelCompanies.title')}</Title>
      <Button title={t('personnelCompanies.add')} onPress={openAdd} />
      <Segmented
        options={[
          { value: 'active', label: t('personnelCompanies.active') },
          { value: 'archived', label: t('personnelCompanies.includeArchived') },
        ]}
        value={includeArchived ? 'archived' : 'active'}
        onChange={(v) => setIncludeArchived(v === 'archived')}
      />

      {q.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState label={t('personnelCompanies.loadError')} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState label={t('personnelCompanies.empty')} />
      ) : (
        q.data.items.map((c) => (
          <Card key={c.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flexShrink: 1, marginEnd: Number(theme.tokens.spacing['2']) }}>
                <Body>{c.name}</Body>
                <Body muted>{contactLine(c)}</Body>
              </View>
              {c.isArchived ? (
                <StatusPill label={t('personnelCompanies.archived')} tone="warning" />
              ) : null}
            </Row>

            <Row
              style={{
                justifyContent: 'flex-end',
                gap: Number(theme.tokens.spacing['2']),
                marginTop: Number(theme.tokens.spacing['3']),
              }}
            >
              <View style={{ minWidth: 110 }}>
                <Button
                  title={t('common.edit')}
                  variant="secondary"
                  onPress={() => openEdit(c)}
                />
              </View>
              <View style={{ minWidth: 110 }}>
                <Button
                  title={c.isArchived ? t('personnelCompanies.unarchive') : t('common.archive')}
                  variant={c.isArchived ? 'primary' : 'secondary'}
                  onPress={() => toggleArchive(c)}
                />
              </View>
              <View style={{ minWidth: 110 }}>
                <Button
                  title={t('personnelCompanies.remove')}
                  variant="danger"
                  onPress={() => confirmRemove(c)}
                />
              </View>
            </Row>
          </Card>
        ))
      )}

      <PersonnelCompanyFormModal
        visible={formVisible}
        company={editTarget}
        onClose={() => setFormVisible(false)}
      />
    </Screen>
  );
}
