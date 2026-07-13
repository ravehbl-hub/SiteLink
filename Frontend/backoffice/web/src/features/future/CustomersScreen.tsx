/** Customers (FUTURE stub). No data fetch, no controls — centered empty-state card. */
import { useTranslation } from 'react-i18next';
import { ComingSoonCard } from '../../components/ui';

export function CustomersScreen() {
  const { t } = useTranslation();
  return <ComingSoonCard title={t('future.customersTitle')} body={t('future.customersBody')} />;
}
