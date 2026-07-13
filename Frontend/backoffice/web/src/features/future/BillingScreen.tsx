/** Billing (FUTURE stub). No data fetch, no controls — centered empty-state card. */
import { useTranslation } from 'react-i18next';
import { ComingSoonCard } from '../../components/ui';

export function BillingScreen() {
  const { t } = useTranslation();
  return <ComingSoonCard title={t('future.billingTitle')} body={t('future.billingBody')} />;
}
