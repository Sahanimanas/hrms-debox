// performance module (Phase 6): pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React from 'react';
import { Target, Award, CalendarClock, MessagesSquare, LifeBuoy, GraduationCap, BadgeCheck, Sparkles } from 'lucide-react';
import GoalsPage from './pages/GoalsPage';
import AppraisalsPage from './pages/AppraisalsPage';
import OneOnOnesPage from './pages/OneOnOnesPage';
import FeedbackPage from './pages/FeedbackPage';
import PipsPage from './pages/PipsPage';
import LearningPage from './pages/LearningPage';
import CertificationsPage from './pages/CertificationsPage';
import SkillsPage from './pages/SkillsPage';
import PendingActionsWidget from './components/PendingActionsWidget';

const ALL = ['admin', 'manager', 'employee'];
const section = 'Performance';

const performanceModule = {
  routes: [
    { path: 'performance/goals', element: <GoalsPage /> },
    { path: 'performance/appraisals', element: <AppraisalsPage /> },
    { path: 'performance/one-on-ones', element: <OneOnOnesPage /> },
    { path: 'performance/feedback', element: <FeedbackPage /> },
    { path: 'performance/pips', element: <PipsPage /> },
    { path: 'performance/learning', element: <LearningPage /> },
    { path: 'performance/certifications', element: <CertificationsPage /> },
    { path: 'performance/skills', element: <SkillsPage /> },
  ],
  publicRoutes: [],
  nav: [
    { name: 'Goals & OKRs', href: '/performance/goals', icon: Target, roles: ALL, section },
    { name: 'Appraisals', href: '/performance/appraisals', icon: Award, roles: ALL, section },
    { name: '1:1 Meetings', href: '/performance/one-on-ones', icon: CalendarClock, roles: ALL, section },
    { name: 'Feedback', href: '/performance/feedback', icon: MessagesSquare, roles: ALL, section },
    // Employees reach their own PIP from the notification / dashboard link (?id=…);
    // the sidebar entry is for the people who run PIPs.
    { name: 'Improvement Plans', href: '/performance/pips', icon: LifeBuoy, roles: ['admin', 'manager'], section },
    { name: 'Learning', href: '/performance/learning', icon: GraduationCap, roles: ALL, section },
    { name: 'Certifications', href: '/performance/certifications', icon: BadgeCheck, roles: ALL, section },
    { name: 'Skills', href: '/performance/skills', icon: Sparkles, roles: ALL, section },
  ],
  dashboardWidgets: [
    { key: 'performance-pending-actions', component: PendingActionsWidget, roles: ALL, order: 40 },
  ],
};

export default performanceModule;
