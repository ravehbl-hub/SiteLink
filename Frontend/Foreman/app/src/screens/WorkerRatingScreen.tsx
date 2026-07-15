/**
 * Worker Rating (FR-FOR-5). The Foreman rates an own-site worker 1–5 with optional
 * notes and submits to POST /workers/:id/ratings { score, notes? }. foremanId is
 * server-derived — never sent. Recent ratings for the selected worker are listed
 * via GET /workers/:id/ratings. Own-site worker picker only (no all-workers view).
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Worker } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { shortDate } from '../lib/format';
import { ApiError } from '../lib/api';
import { useActiveSite } from '../site/ActiveSiteProvider';
import { SitePicker } from '../site/SitePicker';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  RatingRow,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Title,
} from '../components/ui';

export function WorkerRatingScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { activeSiteId } = useActiveSite();

  const [workerId, setWorkerId] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const siteId = activeSiteId ?? undefined;

  const workersQ = useQuery({
    queryKey: qk.workers({ siteId }),
    queryFn: () => endpoints.listWorkers({ siteId }),
    enabled: Boolean(activeSiteId),
  });

  const ratingsQ = useQuery({
    queryKey: qk.workerRatings(workerId ?? ''),
    queryFn: () => endpoints.listWorkerRatings(workerId as string),
    enabled: Boolean(workerId),
  });

  const submitMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      if (score == null) throw new ApiError(0, 'NO_SCORE', 'Select a score');
      return endpoints.createWorkerRating(workerId, {
        date: new Date().toISOString().slice(0, 10),
        score,
        notes: notes.trim() ? notes.trim() : null,
      });
    },
    onSuccess: () => {
      setScore(null);
      setNotes('');
      if (workerId) void qc.invalidateQueries({ queryKey: qk.workerRatings(workerId) });
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  // Switching sites invalidates the worker selection (workers are site-specific).
  React.useEffect(() => {
    setWorkerId(null);
    setScore(null);
    setNotes('');
  }, [activeSiteId]);

  if (!activeSiteId) {
    return (
      <Screen>
        <Title>{t('rating.title')}</Title>
        <Card>
          <EmptyState label={t('common.noSiteAssigned')} />
        </Card>
      </Screen>
    );
  }

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => ({
    value: w.id,
    label: `${w.firstName} ${w.lastName}`,
  }));

  return (
    <Screen>
      <Title>{t('rating.title')}</Title>
      <SitePicker />

      <Card>
        <SectionHeading>{t('rating.worker')}</SectionHeading>
        {workersQ.isLoading ? (
          <Loading />
        ) : workerOptions.length === 0 ? (
          <EmptyState label={t('rating.noWorkers')} />
        ) : (
          <Segmented options={workerOptions} value={workerId} onChange={(v) => setWorkerId(v)} />
        )}

        <SectionHeading>{t('rating.score')}</SectionHeading>
        <RatingRow value={score} onChange={setScore} />

        <View style={{ height: 12 }} />
        <Field
          label={t('rating.notes')}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder={t('rating.notesPlaceholder')}
        />

        <Button
          title={t('rating.submit')}
          onPress={() => submitMut.mutate()}
          loading={submitMut.isPending}
          disabled={!workerId || score == null}
        />
      </Card>

      {workerId ? (
        <>
          <SectionHeading>{t('rating.history')}</SectionHeading>
          {ratingsQ.isLoading ? (
            <Loading />
          ) : !ratingsQ.data || ratingsQ.data.length === 0 ? (
            <EmptyState label={t('rating.noRatings')} />
          ) : (
            ratingsQ.data.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body>{'★'.repeat(r.score) + '☆'.repeat(Math.max(0, 5 - r.score))}</Body>
                  <Body muted>{shortDate(r.createdAt)}</Body>
                </Row>
                {r.notes ? <Body muted>{r.notes}</Body> : null}
              </Card>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
