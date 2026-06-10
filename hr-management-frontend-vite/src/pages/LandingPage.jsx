import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Users, Network, ClipboardCheck, CalendarDays, Wallet, Gift, Receipt,
  CheckSquare, DollarSign, BarChart3, Building2, Bell, ShieldCheck, Smartphone,
  ArrowUpRight, ArrowRight, Check, Menu, X,
} from 'lucide-react';

// Brand fonts (loaded via index.css @import)
const display = { fontFamily: '"Baloo 2", cursive' };
const mono = { fontFamily: '"Space Mono", monospace' };

const features = [
  { icon: Users, title: 'Employee Management', desc: 'A central directory with profiles, departments, designations, documents and government IDs.' },
  { icon: Network, title: 'Org Hierarchy', desc: 'Visualize your reporting structure with a clear, interactive org chart.' },
  { icon: ClipboardCheck, title: 'Attendance Tracking', desc: 'Daily attendance with present, absent, half-day and leave states.' },
  { icon: CalendarDays, title: 'Leave Management', desc: 'Apply, approve and track leaves with configurable policies and per-type balances.' },
  { icon: Wallet, title: 'Leave Balances & Policies', desc: 'Admin-defined quotas, monthly/annual credits and balance adjustments.' },
  { icon: CalendarDays, title: 'Holiday Calendar', desc: 'Company holidays with recurring-holiday support across organizations.' },
  { icon: Gift, title: 'Comp-Off', desc: 'Earn and redeem compensatory offs through a simple approval flow.' },
  { icon: Receipt, title: 'Reimbursements', desc: 'Submit expense claims with receipts; multi-step approval and clearing.' },
  { icon: CheckSquare, title: 'Approvals Workflow', desc: 'Manager → Admin multi-level approvals for leaves, comp-off and claims.' },
  { icon: DollarSign, title: 'Payroll', desc: 'Salary structures, reusable salary templates and payslips.' },
  { icon: BarChart3, title: 'Reports & Analytics', desc: 'Dashboards and exportable HR reports for confident decisions.' },
  { icon: Building2, title: 'Multi-Organization', desc: 'Manage multiple companies and teams from one account.' },
  { icon: Bell, title: 'Notifications', desc: 'In-app bell, email and WhatsApp alerts keep everyone in the loop.' },
  { icon: ShieldCheck, title: 'Role-Based Access', desc: 'Tailored experiences for Admin, Manager and Employee roles.' },
  { icon: Smartphone, title: 'Installable PWA', desc: 'Works on desktop and mobile, installable like a native app.' },
];

// Rotating accent palette so the feature grid feels colorful (full literal
// class strings so Tailwind's JIT picks them up).
const cardColors = [
  { tile: 'bg-amber-100', icon: 'text-amber-600', grad: 'from-amber-50', border: 'hover:border-amber-400' },
  { tile: 'bg-blue-100', icon: 'text-blue-600', grad: 'from-blue-50', border: 'hover:border-blue-400' },
  { tile: 'bg-emerald-100', icon: 'text-emerald-600', grad: 'from-emerald-50', border: 'hover:border-emerald-400' },
  { tile: 'bg-violet-100', icon: 'text-violet-600', grad: 'from-violet-50', border: 'hover:border-violet-400' },
  { tile: 'bg-rose-100', icon: 'text-rose-600', grad: 'from-rose-50', border: 'hover:border-rose-400' },
  { tile: 'bg-cyan-100', icon: 'text-cyan-600', grad: 'from-cyan-50', border: 'hover:border-cyan-400' },
];

const modules = [
  { no: '01', title: 'Recruitment & Onboarding', desc: 'Bring new hires in and set them up in minutes.' },
  { no: '02', title: 'Time, Attendance & Leave', desc: 'One source of truth for who is in, off, or on leave.' },
  { no: '03', title: 'Payroll & Reimbursements', desc: 'Pay people correctly and reimburse expenses on time.' },
  { no: '04', title: 'Reports & Compliance', desc: 'Stay audit-ready with clean, exportable records.' },
];

const steps = [
  { no: '1', title: 'Set up your organization', desc: 'Configure your company, departments and leave policies in a guided wizard.' },
  { no: '2', title: 'Add employees & roles', desc: 'Invite your team and assign Admin, Manager or Employee access.' },
  { no: '3', title: 'Run HR from one dashboard', desc: 'Approve leaves, process payroll and track everything in real time.' },
];

const roles = [
  { title: 'Admin', header: 'from-amber-400 to-yellow-500', text: 'text-slate-900', dot: 'bg-amber-400', check: 'text-slate-900', points: ['Full organization control', 'Payroll & policies', 'Reports & settings'] },
  { title: 'Manager', header: 'from-blue-500 to-indigo-600', text: 'text-white', dot: 'bg-blue-500', check: 'text-white', points: ['Approve team requests', 'View team hierarchy', 'Track attendance'] },
  { title: 'Employee', header: 'from-emerald-500 to-teal-600', text: 'text-white', dot: 'bg-emerald-500', check: 'text-white', points: ['Apply for leave & comp-off', 'Submit reimbursements', 'View payslips & profile'] },
];

const LandingPage = () => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const goLogin = () => navigate('/login');
  const goRegister = () => navigate('/login?tab=register');

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: 'Public Sans, sans-serif' }}>
      {/* ===== Navbar ===== */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-9 w-auto" />

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#how" className="hover:text-slate-900 transition-colors">How it works</a>
            <a href="#roles" className="hover:text-slate-900 transition-colors">Roles</a>
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <Button variant="ghost" onClick={goLogin} className="text-slate-700 hover:text-slate-900">
              Login
            </Button>
            <Button
              onClick={goRegister}
              className="bg-yellow-400 text-slate-900 hover:bg-yellow-500 font-semibold"
            >
              Register
            </Button>
          </div>

          <button className="md:hidden p-2 text-slate-700" onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-slate-100 px-4 py-4 space-y-3 bg-white">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block text-slate-700">Features</a>
            <a href="#how" onClick={() => setMenuOpen(false)} className="block text-slate-700">How it works</a>
            <a href="#roles" onClick={() => setMenuOpen(false)} className="block text-slate-700">Roles</a>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={goLogin} className="flex-1">Login</Button>
              <Button onClick={goRegister} className="flex-1 bg-yellow-400 text-slate-900 hover:bg-yellow-500 font-semibold">Register</Button>
            </div>
          </div>
        )}
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-16 text-center">
          <span
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-xs uppercase tracking-widest"
            style={mono}
          >
            ◆ Transforming Workplaces ◆
          </span>

          <h1 className="mt-6 text-4xl sm:text-6xl leading-tight text-slate-900" style={display}>
            Run your entire HR <br className="hidden sm:block" />
            from <span className="text-yellow-500">one place</span>
          </h1>

          <p className="mt-5 max-w-2xl mx-auto text-lg text-slate-600">
            DeBox brings employees, attendance, leaves, payroll and approvals together —
            so your team spends less time on paperwork and more time on people.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              onClick={goRegister}
              className="bg-yellow-400 text-slate-900 hover:bg-yellow-500 font-semibold px-7 h-12 text-base"
            >
              Get started free <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            <Button
              variant="outline"
              onClick={goLogin}
              className="px-7 h-12 text-base border-slate-300"
            >
              Login to your account
            </Button>
          </div>

          {/* Stat strip */}
          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {[
              ['15+', 'HR modules'],
              ['3', 'Role levels'],
              ['100%', 'Paperless'],
              ['24/7', 'Access (PWA)'],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="text-3xl text-slate-900" style={display}>{n}</div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mt-1" style={mono}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Flagship modules (numbered list) ===== */}
      <section className="bg-slate-50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-12">
            <span className="text-xs uppercase tracking-widest text-yellow-700" style={mono}>What drives us</span>
            <h2 className="mt-3 text-3xl sm:text-4xl text-slate-900" style={display}>
              Passion for people, dedication to results
            </h2>
          </div>

          <div className="divide-y divide-slate-200 border-t border-b border-slate-200">
            {modules.map((m) => (
              <button
                key={m.no}
                onClick={goRegister}
                className="group w-full flex items-center gap-6 py-7 text-left transition-colors hover:bg-white rounded-xl px-2 sm:px-4"
              >
                <span className="text-lg text-slate-400 w-10 shrink-0" style={mono}>{m.no}</span>
                <span className="flex-1">
                  <span className="block text-xl sm:text-2xl text-slate-900 group-hover:text-yellow-600 transition-colors" style={display}>
                    {m.title}
                  </span>
                  <span className="block text-sm text-slate-500 mt-1">{m.desc}</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-xs uppercase tracking-widest text-slate-700 group-hover:text-yellow-600" style={mono}>
                  View details <ArrowUpRight className="w-4 h-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Features grid ===== */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-14">
          <span className="text-xs uppercase tracking-widest text-yellow-700" style={mono}>Everything you need</span>
          <h2 className="mt-3 text-3xl sm:text-4xl text-slate-900" style={display}>
            One platform for your whole HR workflow
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, desc }, i) => {
            const c = cardColors[i % cardColors.length];
            return (
              <div
                key={title}
                className={`rounded-2xl border border-slate-200 p-6 bg-gradient-to-br ${c.grad} to-white ${c.border} hover:shadow-lg transition-all`}
              >
                <div className={`w-12 h-12 rounded-xl ${c.tile} flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${c.icon}`} />
                </div>
                <h3 className="text-xl text-slate-900" style={display}>{title}</h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how" className="bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-14">
            <span className="text-xs uppercase tracking-widest text-yellow-700" style={mono}>Get going in minutes</span>
            <h2 className="mt-3 text-3xl sm:text-4xl text-slate-900" style={display}>How it works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.no} className="text-center">
                <div className="w-14 h-14 mx-auto rounded-full bg-yellow-400 text-slate-900 flex items-center justify-center text-2xl" style={display}>
                  {s.no}
                </div>
                <h3 className="mt-5 text-xl text-slate-900" style={display}>{s.title}</h3>
                <p className="text-sm text-slate-600 mt-2">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Roles ===== */}
      <section id="roles" className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-14">
          <span className="text-xs uppercase tracking-widest text-yellow-700" style={mono}>Built for every role</span>
          <h2 className="mt-3 text-3xl sm:text-4xl text-slate-900" style={display}>The right view for everyone</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {roles.map((r) => (
            <div key={r.title} className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm hover:shadow-lg transition-shadow">
              <div className={`bg-gradient-to-r ${r.header} px-8 py-6`}>
                <h3 className={`text-2xl ${r.text}`} style={display}>{r.title}</h3>
              </div>
              <ul className="p-8 space-y-3">
                {r.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-slate-700">
                    <span className={`mt-0.5 w-5 h-5 rounded-full ${r.dot} flex items-center justify-center shrink-0`}>
                      <Check className={`w-3.5 h-3.5 ${r.check}`} />
                    </span>
                    <span className="text-sm">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CTA band ===== */}
      <section className="bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-5xl text-white" style={display}>
            Ready to simplify your <span className="text-yellow-400">HR</span>?
          </h2>
          <p className="mt-4 text-slate-300 max-w-xl mx-auto">
            Create your account and bring your whole team onto DeBox today.
            No credit card required.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              onClick={goRegister}
              className="bg-yellow-400 text-slate-900 hover:bg-yellow-500 font-semibold px-8 h-12 text-base"
            >
              Register now <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            <Button
              variant="outline"
              onClick={goLogin}
              className="px-8 h-12 text-base bg-transparent text-white border-slate-600 hover:bg-slate-800 hover:text-yellow-400"
            >
              Login
            </Button>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="bg-slate-950 text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 flex flex-col sm:flex-row items-center justify-between gap-6">
          <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-9 w-auto" />
          <div className="flex items-center gap-6 text-sm">
            <a href="#features" className="hover:text-yellow-400 transition-colors">Features</a>
            <a href="#how" className="hover:text-yellow-400 transition-colors">How it works</a>
            <button onClick={goLogin} className="hover:text-yellow-400 transition-colors">Login</button>
            <button onClick={goRegister} className="hover:text-yellow-400 transition-colors">Register</button>
          </div>
        </div>
        <div className="border-t border-slate-800 py-5 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} DeBox — Human Resource Management System.
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
