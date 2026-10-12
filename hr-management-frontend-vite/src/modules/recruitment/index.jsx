// recruitment module (Phase 7 — ATS): pages, sidebar entries and dashboard widgets.
// See src/modules/registry.js for the shape of each field.
import React from 'react';
import { ClipboardList, Briefcase, Users, CalendarClock, Handshake, UserPlus, Users2 } from 'lucide-react';
import RequisitionsPage from './pages/RequisitionsPage';
import JobsPage from './pages/JobsPage';
import JobPipelinePage from './pages/JobPipelinePage';
import CandidatesPage from './pages/CandidatesPage';
import CandidateProfilePage from './pages/CandidateProfilePage';
import MyInterviewsPage from './pages/MyInterviewsPage';
import OffersPage from './pages/OffersPage';
import ReferPage from './pages/ReferPage';
import MyReferralsPage from './pages/MyReferralsPage';
import CareersPage from './pages/CareersPage';
import CareerJobPage from './pages/CareerJobPage';
import RecruitmentWidget from './components/RecruitmentWidget';

const ALL = ['admin', 'manager', 'employee'];
const STAFF = ['admin', 'manager'];
const SECTION = 'Recruitment';

const recruitmentModule = {
  routes: [
    { path: 'recruitment/requisitions', element: <RequisitionsPage /> },
    { path: 'recruitment/jobs', element: <JobsPage /> },
    { path: 'recruitment/jobs/:id', element: <JobPipelinePage /> },
    { path: 'recruitment/candidates', element: <CandidatesPage /> },
    // Profile is also opened by assigned interviewers (limited view enforced by the API)
    { path: 'recruitment/candidates/:id', element: <CandidateProfilePage /> },
    { path: 'recruitment/interviews', element: <MyInterviewsPage /> },
    { path: 'recruitment/offers', element: <OffersPage /> },
    { path: 'recruitment/refer', element: <ReferPage /> },
    { path: 'recruitment/my-referrals', element: <MyReferralsPage /> },
  ],
  publicRoutes: [
    { path: '/careers', element: <CareersPage /> },
    { path: '/careers/:slug', element: <CareerJobPage /> },
  ],
  nav: [
    { name: 'Jobs', href: '/recruitment/jobs', icon: Briefcase, roles: STAFF, section: SECTION },
    { name: 'Candidates', href: '/recruitment/candidates', icon: Users, roles: STAFF, section: SECTION },
    { name: 'Requisitions', href: '/recruitment/requisitions', icon: ClipboardList, roles: STAFF, section: SECTION },
    { name: 'Offers', href: '/recruitment/offers', icon: Handshake, roles: STAFF, section: SECTION },
    { name: 'My Interviews', href: '/recruitment/interviews', icon: CalendarClock, roles: ALL, section: SECTION },
    { name: 'Refer a Candidate', href: '/recruitment/refer', icon: UserPlus, roles: ALL, section: SECTION },
    { name: 'My Referrals', href: '/recruitment/my-referrals', icon: Users2, roles: ALL, section: SECTION },
  ],
  dashboardWidgets: [
    { key: 'recruitment-summary', component: RecruitmentWidget, roles: ALL, order: 60 },
  ],
};

export default recruitmentModule;
