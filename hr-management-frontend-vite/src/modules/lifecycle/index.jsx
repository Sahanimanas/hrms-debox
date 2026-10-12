// lifecycle module (Phase 3 — employee lifecycle): pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React, { lazy, Suspense } from 'react';
import { Rocket, ClipboardCheck, DoorOpen, LogOut, MessageSquareText, FolderLock, FileSignature, Hourglass, UserCog, Network, FolderOpen } from 'lucide-react';
import { MyOnboardingWidget, PeoplePulseWidget } from './components/Widgets';

const MyOnboardingPage = lazy(() => import('./pages/MyOnboardingPage'));
const OnboardingAdminPage = lazy(() => import('./pages/OnboardingAdminPage'));
const MyExitPage = lazy(() => import('./pages/MyExitPage'));
const OffboardingPage = lazy(() => import('./pages/OffboardingPage'));
const ExitInterviewsPage = lazy(() => import('./pages/ExitInterviewsPage'));
const MyDocumentsPage = lazy(() => import('./pages/MyDocumentsPage'));
const DocumentsAdminPage = lazy(() => import('./pages/DocumentsAdminPage'));
const LettersPage = lazy(() => import('./pages/LettersPage'));
const ProbationPage = lazy(() => import('./pages/ProbationPage'));
const ProfileRequestsPage = lazy(() => import('./pages/ProfileRequestsPage'));
const OrgChartPage = lazy(() => import('./pages/OrgChartPage'));

const Fallback = (
  <div className="flex items-center justify-center py-24">
    <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full" />
  </div>
);
const page = (component) => {
  const Component = component;
  return <Suspense fallback={Fallback}><Component /></Suspense>;
};

const ALL = ['admin', 'manager', 'employee'];
const SECTION = 'People';

const lifecycleModule = {
  routes: [
    { path: 'my-onboarding', element: page(MyOnboardingPage) },
    { path: 'onboarding', element: page(OnboardingAdminPage) },
    { path: 'my-exit', element: page(MyExitPage) },
    { path: 'offboarding', element: page(OffboardingPage) },
    { path: 'exit-interviews', element: page(ExitInterviewsPage) },
    { path: 'my-documents', element: page(MyDocumentsPage) },
    { path: 'documents', element: page(DocumentsAdminPage) },
    { path: 'letters', element: page(LettersPage) },
    { path: 'probation', element: page(ProbationPage) },
    { path: 'profile-requests', element: page(ProfileRequestsPage) },
    { path: 'org-chart', element: page(OrgChartPage) },
  ],
  publicRoutes: [],
  nav: [
    { name: 'Org Chart', href: '/org-chart', icon: Network, roles: ['employee'], section: SECTION },
    { name: 'My Onboarding', href: '/my-onboarding', icon: Rocket, roles: ALL, section: SECTION },
    { name: 'My Documents', href: '/my-documents', icon: FolderOpen, roles: ALL, section: SECTION },
    { name: 'Resignation', href: '/my-exit', icon: DoorOpen, roles: ['employee', 'manager'], section: SECTION },
    { name: 'Onboarding', href: '/onboarding', icon: ClipboardCheck, roles: ['admin', 'manager'], section: SECTION },
    { name: 'Probation', href: '/probation', icon: Hourglass, roles: ['admin', 'manager'], section: SECTION },
    { name: 'Offboarding', href: '/offboarding', icon: LogOut, roles: ['admin', 'manager'], section: SECTION },
    { name: 'Exit Interviews', href: '/exit-interviews', icon: MessageSquareText, roles: ['admin'], section: SECTION },
    { name: 'Document Vault', href: '/documents', icon: FolderLock, roles: ['admin'], section: SECTION },
    { name: 'Letters', href: '/letters', icon: FileSignature, roles: ['admin'], section: SECTION },
    { name: 'Profile Requests', href: '/profile-requests', icon: UserCog, roles: ['admin'], section: SECTION },
  ],
  dashboardWidgets: [
    { key: 'lifecycle-people-pulse', component: PeoplePulseWidget, roles: ['admin', 'manager'], order: 30 },
    { key: 'lifecycle-my-onboarding', component: MyOnboardingWidget, roles: ALL, order: 31 },
  ],
};

export default lifecycleModule;
