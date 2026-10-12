// Xeno PM pages, nested under the PmLayout shell at /pm (wired in App.jsx).
import React from 'react';
import PmHomePage from './pages/PmHomePage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import MyTasksPage from './pages/MyTasksPage';
import WorkloadPage from './pages/WorkloadPage';

export const pmRoutes = [
  { index: true, element: <PmHomePage /> },
  { path: 'my-tasks', element: <MyTasksPage /> },
  { path: 'projects', element: <ProjectsPage /> },
  { path: 'projects/:id', element: <ProjectPage /> },
  { path: 'workload', element: <WorkloadPage /> },
];
