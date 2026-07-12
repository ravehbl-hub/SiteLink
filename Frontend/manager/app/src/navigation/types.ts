/** Navigation param lists (typed @react-navigation). */
export type WorkersStackParamList = {
  WorkersList: undefined;
  WorkerWizard: undefined;
  WorkerDetails: { workerId: string };
};

export type DrawerParamList = {
  Dashboard: undefined;
  Workers: undefined;
  Attendance: undefined;
  Finance: undefined;
  Payment: undefined;
  Salary: undefined;
  Sites: undefined;
  Users: undefined;
  Settings: undefined;
};
