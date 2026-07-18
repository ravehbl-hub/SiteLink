/** Navigation param lists (typed @react-navigation). */
export type WorkersStackParamList = {
  WorkersList: undefined;
  // WorkerWizard doubles as the ADD (no param) and EDIT (workerId present) form.
  // On EDIT the first-password field is omitted (backend PATCH never resets auth pw).
  WorkerWizard: { workerId?: string } | undefined;
  WorkerDetails: { workerId: string };
};

export type DrawerParamList = {
  Dashboard: undefined;
  Requests: undefined;
  Workers: undefined;
  Attendance: undefined;
  Finance: undefined;
  Payment: undefined;
  Salary: undefined;
  Sites: undefined;
  Users: undefined;
  PersonnelCompanies: undefined;
  Settings: undefined;
};
