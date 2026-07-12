/**
 * Worker Details (FR-MGR-EMP-2/3/4/5/6). Shows Details + Docs + Salary data.
 * Docs support CAMERA capture (FR-MGR-PARITY-2) via the signed-URL flow
 * (Architecture §7a): request upload-url → PUT bytes to Supabase → confirm →
 * persist FileRef. Viewing a doc mints a short-lived signed READ url.
 * Archive/remove per FR-MGR-EMP-5/6.
 */
import React, { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WorkerDocType } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { uploadToSignedUrl, ApiError } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { captureFromCamera, pickFromLibrary } from '../../lib/camera';
import { shortDate } from '../../lib/format';
import type { WorkersStackParamList } from '../../navigation/types';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';

type Props = NativeStackScreenProps<WorkersStackParamList, 'WorkerDetails'>;

export function WorkerDetailsScreen({ route, navigation }: Props) {
  const { workerId } = route.params;
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<WorkerDocType>(WorkerDocType.PASSPORT_ID);
  const [uploading, setUploading] = useState(false);

  const q = useQuery({
    queryKey: qk.worker(workerId),
    queryFn: () => endpoints.getWorker(workerId),
  });

  const archiveMut = useMutation({
    mutationFn: () => endpoints.archiveWorker(workerId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workers'] });
      navigation.goBack();
    },
  });

  const removeMut = useMutation({
    mutationFn: () => endpoints.removeWorker(workerId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['workers'] });
      navigation.goBack();
    },
  });

  /** Full signed-URL doc upload (Architecture §7a). */
  async function uploadDoc(source: 'camera' | 'library') {
    const file = source === 'camera' ? await captureFromCamera() : await pickFromLibrary();
    if (!file) return;
    setUploading(true);
    try {
      const signed = await endpoints.requestDocUpload(workerId, {
        type: docType,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      await uploadToSignedUrl(signed.uploadUrl, file.uri, file.mimeType);
      await endpoints.confirmDoc(workerId, {
        type: docType,
        storageKey: signed.storageKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      });
      await qc.invalidateQueries({ queryKey: qk.worker(workerId) });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function viewDoc(docId: string) {
    try {
      const { url } = await endpoints.getDocReadUrl(workerId, docId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    }
  }

  if (q.isLoading) return <Loading label={t('common.loading')} />;
  if (q.isError || !q.data)
    return <ErrorState label={t('common.error')} onRetry={() => q.refetch()} />;

  const w = q.data;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>
          {w.firstName} {w.lastName}
        </Title>
        {w.isArchived ? <StatusPill label={t('workers.archived')} tone="warning" /> : null}
      </Row>

      <Card>
        <SectionHeading>{t('workers.details')}</SectionHeading>
        <DetailRow label={t('workers.profession')} value={t(`professions.${w.profession}`)} />
        <DetailRow label={t('workers.level')} value={t(`levels.${w.level}`)} />
        <DetailRow label={t('workers.phone')} value={w.phone ?? '—'} />
        <DetailRow label={t('workers.country')} value={w.country ?? '—'} />
        <DetailRow label={t('workers.personnelCompany')} value={w.personnelCompany ?? '—'} />
        <DetailRow label={t('workers.startDate')} value={shortDate(w.startDate)} />
      </Card>

      <Card>
        <SectionHeading>{t('workers.salaryData')}</SectionHeading>
        {w.salaryData ? (
          <>
            <DetailRow
              label={t('workers.hourlyWage')}
              value={`${w.salaryData.hourlyWage} ${w.salaryData.currency}`}
            />
            <DetailRow
              label={t('workers.workingConditions')}
              value={w.salaryData.workingConditions ?? '—'}
            />
          </>
        ) : (
          <Body muted>{t('common.empty')}</Body>
        )}
      </Card>

      <Card>
        <SectionHeading>{t('workers.docs')}</SectionHeading>
        <Segmented
          options={Object.values(WorkerDocType).map((v) => ({ value: v, label: t(`docTypes.${v}`) }))}
          value={docType}
          onChange={(v) => setDocType(v)}
        />
        <Row>
          <View style={{ flex: 1, marginEnd: 8 }}>
            <Button
              title={t('workers.takePhoto')}
              variant="secondary"
              onPress={() => uploadDoc('camera')}
              loading={uploading}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('workers.chooseFromLibrary')}
              variant="secondary"
              onPress={() => uploadDoc('library')}
              loading={uploading}
            />
          </View>
        </Row>

        {w.docs.length === 0 ? (
          <EmptyState label={t('workers.noDocs')} />
        ) : (
          w.docs.map((d) => (
            <Row key={d.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
              <View>
                <Body>{t(`docTypes.${d.type}`)}</Body>
                <Body muted>{d.file.fileName}</Body>
              </View>
              <Button title={t('workers.viewDoc')} variant="secondary" onPress={() => viewDoc(d.id)} />
            </Row>
          ))
        )}
      </Card>

      {!w.isArchived ? (
        <Button
          title={t('common.archive')}
          variant="secondary"
          onPress={() =>
            Alert.alert(t('workers.archiveConfirm'), '', [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.archive'), onPress: () => archiveMut.mutate() },
            ])
          }
        />
      ) : null}
      <Button
        title={t('common.remove')}
        variant="danger"
        onPress={() =>
          Alert.alert(t('workers.removeConfirm'), '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.remove'), style: 'destructive', onPress: () => removeMut.mutate() },
          ])
        }
      />
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Body muted>{label}</Body>
      <Body>{value}</Body>
    </Row>
  );
}
