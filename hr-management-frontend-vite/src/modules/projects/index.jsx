// projects module (Xeno PM). Its pages live in their own app shell at /pm
// (see ./routes.jsx, mounted in App.jsx); inside Xeno HR it only adds a
// dashboard card with the user's open project tasks.
// See src/modules/registry.js for the shape of each field.
import MyTasksWidget from './components/MyTasksWidget';

const ALL_ROLES = ['admin', 'manager', 'employee'];

const projectsModule = {
  routes: [],
  publicRoutes: [],
  nav: [],
  dashboardWidgets: [
    { key: 'pm-my-tasks', component: MyTasksWidget, roles: ALL_ROLES, order: 15 },
  ],
};

export default projectsModule;
