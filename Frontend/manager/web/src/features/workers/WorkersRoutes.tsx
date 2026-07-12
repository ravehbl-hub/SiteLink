import { Route, Routes } from 'react-router-dom';
import { WorkersList } from './WorkersList';
import { WorkerWizard } from './WorkerWizard';
import { WorkerDetail } from './WorkerDetail';

export function WorkersRoutes() {
  return (
    <Routes>
      <Route index element={<WorkersList />} />
      <Route path="new" element={<WorkerWizard />} />
      <Route path=":id" element={<WorkerDetail />} />
    </Routes>
  );
}
