/**
 * Loans + Advances (FR-MGR-LOAN / FR-MGR-ADV). Record loans/advances per worker
 * and list outstanding balances that feed the dashboard rollup.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Worker } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { money, shortDate } from '../../lib/format';
import { ApiError } from '../../lib/api';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Title,
} from '../../components/ui';

type Kind = 'loans' | 'advances';

export function FinanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('loans');
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const workersQ = useQuery({ queryKey: qk.workers(), queryFn: () => endpoints.listWorkers() });
  const loansQ = useQuery({ queryKey: qk.loans(), queryFn: () => endpoints.listLoans() });
  const advQ = useQuery({ queryKey: qk.advances(), queryFn: () => endpoints.listAdvances() });

  const addMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      const body = {
        workerId,
        amount: Number(amount),
        currency: 'ILS',
        date: new Date().toISOString(),
      };
      return kind === 'loans' ? endpoints.createLoan(body) : endpoints.createAdvance(body);
    },
    onSuccess: async () => {
      setAmount('');
      await qc.invalidateQueries({ queryKey: [kind] });
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => ({
    value: w.id,
    label: `${w.firstName} ${w.lastName}`,
  }));

  const list = (kind === 'loans' ? loansQ.data : advQ.data)?.items;
  const loading = kind === 'loans' ? loansQ.isLoading : advQ.isLoading;

  return (
    <Screen>
      <Title>{t('finance.title')}</Title>
      <Segmented
        options={[
          { value: 'loans', label: t('finance.loans') },
          { value: 'advances', label: t('finance.advances') },
        ]}
        value={kind}
        onChange={(v) => setKind(v)}
      />

      <Card glow>
        <SectionHeading>
          {kind === 'loans' ? t('finance.addLoan') : t('finance.addAdvance')}
        </SectionHeading>
        <Segmented options={workerOptions} value={workerId} onChange={(v) => setWorkerId(v)} />
        <Field
          label={t('common.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
        />
        <Button
          title={t('common.add')}
          onPress={() => addMut.mutate()}
          loading={addMut.isPending}
          disabled={!workerId || !amount}
        />
      </Card>

      {loading ? (
        <Loading />
      ) : !list || list.length === 0 ? (
        <EmptyState label={kind === 'loans' ? t('finance.noLoans') : t('finance.noAdvances')} />
      ) : (
        list.map((item) => (
          <Card key={item.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body tabular>{money(item.amount, item.currency)}</Body>
                <Body muted>{shortDate(item.date)}</Body>
              </View>
              <View>
                <Body muted>{t('finance.outstanding')}</Body>
                <Body tabular>{money(item.outstanding, item.currency)}</Body>
              </View>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
