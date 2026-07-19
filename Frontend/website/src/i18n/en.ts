export const en = {
  nav: {
    features: 'Features',
    how: 'How it works',
    roles: 'Who it’s for',
    contact: 'Contact',
    login: 'Log in',
    getStarted: 'Get started',
    menu: 'Menu',
    language: 'Language',
  },
  hero: {
    badge: 'Construction workforce management',
    title: 'Run your construction crews from one place',
    subtitle:
      'SiteLink brings every jobsite together — track attendance, compute payroll, approve worker requests and export reports across all your sites, from one dashboard.',
    ctaPrimary: 'Get started',
    ctaSecondary: 'Request a demo',
    highlight1: 'Multi-site',
    highlight2: 'Attendance & payroll',
    highlight3: 'Hebrew · English · Turkish',
  },
  features: {
    title: 'Everything you need to run the crew',
    subtitle: 'Built for the way construction companies actually operate.',
    items: {
      multisite: {
        title: 'Multi-site management',
        body: 'Organize workers, foremen and payroll per jobsite — and see the whole operation at a glance.',
      },
      attendance: {
        title: 'Worker attendance',
        body: 'Log present, vacation and sick days on-site, so hours are always accurate and ready for payroll.',
      },
      payroll: {
        title: 'Salary & payroll',
        body: 'Compute pay from hourly or fixed rates, factoring in working conditions and hours worked.',
      },
      requests: {
        title: 'Requests workflow',
        body: 'Workers file loan, advance and vacation requests; managers approve or reject — and can re-decide when things change.',
      },
      apps: {
        title: 'Foreman & worker apps',
        body: 'Foremen manage attendance across their sites; workers check hours, salary and requests from their phone.',
      },
      admin: {
        title: 'System Admin console',
        body: 'A dedicated console for customers, billing and platform oversight across every company.',
      },
      reports: {
        title: 'PDF reports',
        body: 'Export payslips, working-hours, attendance and profit-and-loss reports as clean, shareable PDFs.',
      },
      staffing: {
        title: 'Staffing companies',
        body: 'Model personnel (staffing) companies and the workers they supply to your sites.',
      },
      roles: {
        title: 'Multi-role access',
        body: 'Scoped permissions for Admin, Manager, Foreman and Worker — everyone sees exactly what they should.',
      },
      i18n: {
        title: 'Hebrew, RTL & multilingual',
        body: 'Hebrew-first with full right-to-left support, plus English and Turkish out of the box.',
      },
    },
  },
  how: {
    title: 'How SiteLink works',
    subtitle: 'From setup to payroll in five steps.',
    steps: {
      s1: { title: 'Set up your sites', body: 'Create each jobsite and define its details.' },
      s2: { title: 'Add workers', body: 'Add your workers and hand them their own logins.' },
      s3: { title: 'Log attendance on-site', body: 'Foremen record who is present, on vacation or sick, every day.' },
      s4: { title: 'Approve & run payroll', body: 'Managers approve requests and compute salaries from the hours.' },
      s5: { title: 'Export reports', body: 'Generate payslips and management reports as PDFs.' },
    },
  },
  roles: {
    title: 'Built for every role on the job',
    subtitle: 'Each person gets a surface tailored to what they do.',
    items: {
      manager: {
        name: 'Manager',
        surface: 'Web',
        body: 'Manage sites, workers, payroll, requests and reports for the whole company.',
      },
      foreman: {
        name: 'Foreman',
        surface: 'Mobile app',
        body: 'Log attendance and manage their own workers — scoped to their assigned sites.',
      },
      worker: {
        name: 'Worker',
        surface: 'Mobile app',
        body: 'Check my hours, my salary and file my own requests, all from my phone.',
      },
      admin: {
        name: 'System Admin',
        surface: 'Web',
        body: 'Oversee customers, billing and the platform across every company.',
      },
    },
  },
  contact: {
    title: 'Ready to see SiteLink in action?',
    subtitle: 'Tell us about your crews and we’ll set you up with a demo.',
    name: 'Your name',
    email: 'Email',
    message: 'How can we help?',
    send: 'Send message',
    note: 'This form opens your email app — no account needed.',
    or: 'Or email us directly at',
  },
  footer: {
    tagline: 'Construction workforce management, from site to payslip.',
    sections: 'Explore',
    contact: 'Contact',
    rights: 'All rights reserved.',
  },
};

export type Resources = typeof en;
