/** Payment management (FR-MGR-PAY): profession wage rates + calc mode
 *  (israeli-labor-law | fixed). Add/Modify/Remove. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Profession,
  RateType,
  SalaryCalcMode,
  type CreateProfessionWageRateInput,
  type ProfessionWageRate,
} from '@sitelink/shared';
import { paymentApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList } from '../../lib/api/hooks';
import { DataState, Modal, Field, Chip } from '../../components/ui';
import { formatCurrency } from '../../lib/format';

export function PaymentScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Profession wage rates are rarely-changing reference data — long staleTime, no
  // polling; focus refetch + mutation invalidation keep it current.
  const list = useQuery({
    queryKey: qk.wageRates,
    queryFn: () => paymentApi.list(),
    staleTime: 5 * 60_000,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProfessionWageRate | null>(null);

  const removeMut = useMutation({
    mutationFn: (id: string) => paymentApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.wageRates }),
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('payment.title')}
        </h1>
        <div className="header-spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('payment.newRate')}
        </button>
      </div>

      <div className="card">
        <h3 className="subsection-title">{t('payment.wageRates')}</h3>
        <DataState isLoading={list.isLoading} error={list.error} isEmpty={list.data?.length === 0}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('workers.profession')}</th>
                  <th>{t('payment.wage')}</th>
                  <th>{t('workers.rateType')}</th>
                  <th>{t('payment.calcMode')}</th>
                  <th>{t('payment.site')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.map((r) => (
                  <tr key={r.id}>
                    <td>{t(`profession.${r.profession}`)}</td>
                    <td>{formatCurrency(r.wage, r.currency)}</td>
                    <td>{t(`rateType.${r.rateType}`)}</td>
                    <td>
                      <Chip tone={r.calcMode === SalaryCalcMode.ISRAELI_LABOR_LAW ? 'info' : 'neutral'}>
                        {r.calcMode === SalaryCalcMode.ISRAELI_LABOR_LAW
                          ? t('payment.israeliLaborLaw')
                          : t('payment.fixed')}
                      </Chip>
                    </td>
                    <td>{r.siteId ? r.siteId : t('payment.global')}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(r)}>
                          {t('common.edit')}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => removeMut.mutate(r.id)}
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      {creating ? <RateForm onClose={() => setCreating(false)} /> : null}
      {editing ? <RateForm rate={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function RateForm({ rate, onClose }: { rate?: ProfessionWageRate; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sites = useSitesList();
  const [profession, setProfession] = useState<Profession>(
    (rate?.profession as Profession) ?? Profession.GENERAL_LABORER,
  );
  const [wage, setWage] = useState(rate?.wage ?? 0);
  const [rateType, setRateType] = useState<RateType>(rate?.rateType ?? RateType.HOURLY);
  const [calcMode, setCalcMode] = useState<SalaryCalcMode>(rate?.calcMode ?? SalaryCalcMode.FIXED);
  const [currency, setCurrency] = useState(rate?.currency ?? 'ILS');
  const [siteId, setSiteId] = useState(rate?.siteId ?? '');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (rate) {
        return paymentApi.update(rate.id, { wage, rateType, calcMode, currency });
      }
      const body: CreateProfessionWageRateInput = {
        profession,
        wage,
        rateType,
        calcMode,
        currency,
        siteId: siteId || null,
      };
      return paymentApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.wageRates });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={rate ? t('common.edit') : t('payment.newRate')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('workers.profession')}>
        <select
          className="select"
          value={profession}
          disabled={Boolean(rate)}
          onChange={(e) => setProfession(e.target.value as Profession)}
        >
          {Object.values(Profession).map((p) => (
            <option key={p} value={p}>
              {t(`profession.${p}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('payment.wage')}>
        <input
          className="input"
          type="number"
          min={0}
          value={wage}
          onChange={(e) => setWage(Number(e.target.value) || 0)}
        />
      </Field>
      <Field label={t('workers.rateType')}>
        <select className="select" value={rateType} onChange={(e) => setRateType(e.target.value as RateType)}>
          {Object.values(RateType).map((r) => (
            <option key={r} value={r}>
              {t(`rateType.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('payment.calcMode')}>
        <select
          className="select"
          value={calcMode}
          onChange={(e) => setCalcMode(e.target.value as SalaryCalcMode)}
        >
          <option value={SalaryCalcMode.FIXED}>{t('payment.fixed')}</option>
          <option value={SalaryCalcMode.ISRAELI_LABOR_LAW}>{t('payment.israeliLaborLaw')}</option>
        </select>
      </Field>
      <Field label={t('common.currency')}>
        <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </Field>
      {!rate ? (
        <Field label={t('payment.site')}>
          <select className="select" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{t('payment.global')}</option>
            {sites.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </Modal>
  );
}
