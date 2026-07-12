/**
 * Payment — wage rates by profession + calc mode (FR-MGR-PAY). Manage per-profession
 * hourly/monthly wage and salary calc mode (Israeli labor law | fixed).
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Profession, RateType, SalaryCalcMode } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { money } from '../lib/format';
import { ApiError } from '../lib/api';
import { calcModeOptions, professionOptions, rateTypeOptions } from '../lib/enumOptions';
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
  StatusPill,
  Title,
} from '../components/ui';

export function PaymentScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [profession, setProfession] = useState<Profession>(Profession.GENERAL_LABORER);
  const [wage, setWage] = useState('');
  const [rateType, setRateType] = useState<RateType>(RateType.HOURLY);
  const [calcMode, setCalcMode] = useState<SalaryCalcMode>(SalaryCalcMode.ISRAELI_LABOR_LAW);

  const q = useQuery({ queryKey: qk.wageRates, queryFn: () => endpoints.listWageRates() });

  const addMut = useMutation({
    mutationFn: () =>
      endpoints.createWageRate({
        profession,
        wage: Number(wage),
        rateType,
        calcMode,
        currency: 'ILS',
      }),
    onSuccess: async () => {
      setWage('');
      await qc.invalidateQueries({ queryKey: qk.wageRates });
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <Screen>
      <Title>{t('payment.title')}</Title>

      <Card>
        <SectionHeading>{t('payment.addRate')}</SectionHeading>
        <SectionHeading>{t('workers.profession')}</SectionHeading>
        <Segmented options={professionOptions(t)} value={profession} onChange={setProfession} />
        <Field
          label={t('payment.wage')}
          value={wage}
          onChangeText={setWage}
          keyboardType="numeric"
        />
        <SectionHeading>{t('payment.rateType')}</SectionHeading>
        <Segmented options={rateTypeOptions(t)} value={rateType} onChange={setRateType} />
        <SectionHeading>{t('payment.calcMode')}</SectionHeading>
        <Segmented options={calcModeOptions(t)} value={calcMode} onChange={setCalcMode} />
        <Button
          title={t('common.add')}
          onPress={() => addMut.mutate()}
          loading={addMut.isPending}
          disabled={!wage}
        />
      </Card>

      <SectionHeading>{t('payment.wageRates')}</SectionHeading>
      {q.isLoading ? (
        <Loading />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState label={t('payment.noRates')} />
      ) : (
        q.data.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body>{t(`professions.${r.profession}`)}</Body>
                <Body muted>{money(r.wage, r.currency)}</Body>
              </View>
              <StatusPill
                label={
                  r.calcMode === SalaryCalcMode.ISRAELI_LABOR_LAW
                    ? t('payment.israeliLaborLaw')
                    : t('payment.fixed')
                }
                tone="info"
              />
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
