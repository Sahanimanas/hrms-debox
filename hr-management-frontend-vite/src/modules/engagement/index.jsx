// engagement module: pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import { Megaphone, PartyPopper, FileCheck2, ClipboardList, Vote, Lightbulb, ShieldAlert, Award } from 'lucide-react';
import AnnouncementsPage from './pages/AnnouncementsPage';
import CelebrationsPage from './pages/CelebrationsPage';
import PoliciesPage from './pages/PoliciesPage';
import SurveysPage from './pages/SurveysPage';
import SurveyResultsPage from './pages/SurveyResultsPage';
import PollsPage from './pages/PollsPage';
import SuggestionsPage from './pages/SuggestionsPage';
import GrievancesPage from './pages/GrievancesPage';
import GrievanceTrackPage from './pages/GrievanceTrackPage';
import KudosPage from './pages/KudosPage';
import { AnnouncementsWidget, CelebrationsWidget, KudosWidget, EngagementTodoWidget } from './components/widgets';

const ALL = ['admin', 'manager', 'employee'];
const section = 'Engagement';

const engagementModule = {
  routes: [
    { path: 'engagement/announcements', element: <AnnouncementsPage /> },
    { path: 'engagement/celebrations', element: <CelebrationsPage /> },
    { path: 'engagement/policies', element: <PoliciesPage /> },
    { path: 'engagement/surveys', element: <SurveysPage /> },
    { path: 'engagement/surveys/:id/results', element: <SurveyResultsPage /> },
    { path: 'engagement/polls', element: <PollsPage /> },
    { path: 'engagement/suggestions', element: <SuggestionsPage /> },
    { path: 'engagement/grievances', element: <GrievancesPage /> },
    { path: 'engagement/kudos', element: <KudosPage /> },
  ],
  publicRoutes: [
    { path: '/grievance-status', element: <GrievanceTrackPage /> },
  ],
  nav: [
    { name: 'Announcements', href: '/engagement/announcements', icon: Megaphone, roles: ALL, section },
    { name: 'Celebrations', href: '/engagement/celebrations', icon: PartyPopper, roles: ALL, section },
    { name: 'Kudos', href: '/engagement/kudos', icon: Award, roles: ALL, section },
    { name: 'Policies', href: '/engagement/policies', icon: FileCheck2, roles: ALL, section },
    { name: 'Surveys', href: '/engagement/surveys', icon: ClipboardList, roles: ALL, section },
    { name: 'Polls', href: '/engagement/polls', icon: Vote, roles: ALL, section },
    { name: 'Suggestions', href: '/engagement/suggestions', icon: Lightbulb, roles: ALL, section },
    { name: 'Grievances', href: '/engagement/grievances', icon: ShieldAlert, roles: ALL, section },
  ],
  dashboardWidgets: [
    { key: 'engagement-todo', component: EngagementTodoWidget, roles: ALL, order: 20 },
    { key: 'announcements', component: AnnouncementsWidget, roles: ALL, order: 30 },
    { key: 'celebrations', component: CelebrationsWidget, roles: ALL, order: 40 },
    { key: 'kudos', component: KudosWidget, roles: ALL, order: 60 },
  ],
};

export default engagementModule;
