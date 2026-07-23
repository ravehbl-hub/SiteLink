/**
 * New Request (FR-WRK-3/4/5). ONE screen with a 3-way Segmented
 * (Vacation | Loan | Advance). All three submit through the UNIFIED endpoint
 * POST /requests with body:
 *   { type: 'VACATION'|'LOAN'|'ADVANCE', startDate/endDate (vacation),
 *     amount (loan/advance), notes }
 * workerId + requestedById are server-derived; status defaults PENDING. On success
 * we show a PENDING StatusPill.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RequestType } from '@sitelink/shared';
import { endpoints, type CreateSelfRequestInput } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { ApiError } from '../../lib/api';
import {
  Body,
  Button,
  Card,
  Field,
  Row,
  Screen,
  SectionHeading,
  Select,
  StatusPill,
  Title,
} from '../../components/ui';

function toIsoOrNull(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function NewRequestScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [type, setType] = useState<RequestType>(RequestType.VACATION);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const isVacation = type === RequestType.VACATION;

  const mut = useMutation({
    mutationFn: () => {
      const body: CreateSelfRequestInput = { type, notes: notes.trim() || null };
      if (isVacation) {
        body.startDate = toIsoOrNull(startDate);
        body.endDate = toIsoOrNull(endDate);
      } else {
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new ApiError(0, 'INVALID_AMOUNT', t('newRequest.invalidAmount'));
        }
        body.amount = parsed;
      }
      return endpoints.createRequest(body);
    },
    onSuccess: () => {
      setSubmitted(true);
      setStartDate('');
      setEndDate('');
      setAmount('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: qk.requests() });
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  function onTypeChange(next: RequestType) {
    setType(next);
    setSubmitted(false);
  }

  return (
    <Screen>
      <Title>{t('newRequest.title')}</Title>

      <Card>
        <SectionHeading>{t('newRequest.type')}</SectionHeading>
        <Select
          options={[
            { value: RequestType.VACATION, label: t('requestType.VACATION') },
            { value: RequestType.LOAN, label: t('requestType.LOAN') },
            { value: RequestType.ADVANCE, label: t('requestType.ADVANCE') },
          ]}
          value={type}
          onChange={onTypeChange}
        />

        {isVacation ? (
          <>
            <Field
              label={t('newRequest.startDate')}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            <Field
              label={t('newRequest.endDate')}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </>
        ) : (
          <Field
            label={t('newRequest.amount')}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
          />
        )}

        <Field
          label={t('newRequest.notes')}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        <Button
          title={t('newRequest.submit')}
          onPress={() => mut.mutate()}
          loading={mut.isPending}
        />
      </Card>

      {submitted ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>{t('newRequest.submitted')}</Body>
            <StatusPill label={t('requestStatus.PENDING')} tone="warning" />
          </Row>
          <View style={{ height: 4 }} />
          <Body muted>{t('newRequest.submittedHint')}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}
