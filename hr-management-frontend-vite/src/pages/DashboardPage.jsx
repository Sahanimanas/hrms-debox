import React, { useState, useEffect } from 'react';
import { Users, FileText, CheckCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { getAuth } from '@/lib/auth';
import { format } from 'date-fns';

const DashboardPage = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = getAuth();

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: 'pending',
      manager_approved: 'pending',
      approved: 'approved',
      rejected: 'rejected',
    };
    return statusMap[status] || 'pending';
  };

  const getStatusText = (status) => {
    const textMap = {
      pending: 'Pending',
      manager_approved: 'Manager Approved',
      approved: 'Approved',
      rejected: 'Rejected',
    };
    return textMap[status] || status;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 text-sm sm:text-base">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 md:p-10 space-y-4 sm:space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 sm:mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Dashboard
        </h1>
        <p className="text-sm sm:text-base md:text-lg text-slate-600">Welcome back! Here&apos;s your overview</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <Card data-testid="total-employees-card" className="border-slate-100 shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-3 sm:p-4 md:p-6">
              <div className="flex items-start sm:items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider truncate">
                    <span className="sm:hidden">
                      {user?.role === 'admin' ? 'Employees' : 'Team'}
                    </span>
                    <span className="hidden sm:inline">
                      Total {user?.role === 'admin' ? 'Employees' : 'Team Members'}
                    </span>
                  </p>
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 mt-1 sm:mt-2">{stats?.total_employees || 0}</p>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-amber-50 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ml-2">
                  <Users className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {(user?.role === 'admin' || user?.role === 'manager') && (
          <Card data-testid="pending-leaves-card" className="border-slate-100 shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-3 sm:p-4 md:p-6">
              <div className="flex items-start sm:items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider truncate">
                    <span className="sm:hidden">Pending</span>
                    <span className="hidden sm:inline">Pending Approvals</span>
                  </p>
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 mt-1 sm:mt-2">{stats?.pending_leaves || 0}</p>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-amber-50 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ml-2">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {user?.role === 'admin' && (
          <Card data-testid="approved-leaves-card" className="border-slate-100 shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-3 sm:p-4 md:p-6">
              <div className="flex items-start sm:items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider truncate">
                    <span className="sm:hidden">Approved</span>
                    <span className="hidden sm:inline">Approved This Month</span>
                  </p>
                  <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 mt-1 sm:mt-2">{stats?.approved_leaves_this_month || 0}</p>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-emerald-50 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ml-2">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {stats?.my_leave_balance && (
          <Card data-testid="leave-balance-card" className="border-slate-100 shadow-sm hover:shadow-md transition-all col-span-2 sm:col-span-1">
            <CardContent className="p-3 sm:p-4 md:p-6">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <p className="text-[10px] sm:text-xs md:text-sm font-medium text-slate-500 uppercase tracking-wider">
                  <span className="sm:hidden">My Balance</span>
                  <span className="hidden sm:inline">My Leave Balance</span>
                </p>
                <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-purple-50 rounded-lg sm:rounded-xl flex items-center justify-center">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-purple-600" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div>
                  <p className="text-[10px] sm:text-xs text-slate-500">Sick</p>
                  <p className="text-base sm:text-lg font-bold text-slate-900">{stats.my_leave_balance.sick_leave}</p>
                </div>
                <div>
                  <p className="text-[10px] sm:text-xs text-slate-500">Casual</p>
                  <p className="text-base sm:text-lg font-bold text-slate-900">{stats.my_leave_balance.casual_leave}</p>
                </div>
                <div>
                  <p className="text-[10px] sm:text-xs text-slate-500">Earned</p>
                  <p className="text-base sm:text-lg font-bold text-slate-900">{stats.my_leave_balance.earned_leave}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Leaves */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="text-lg sm:text-xl md:text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Recent Leaves
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6 pt-0">
          {stats?.recent_leaves && stats.recent_leaves.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {stats.recent_leaves.map((leave) => (
                <div
                  key={leave.id}
                  data-testid={`recent-leave-${leave.id}`}
                  className="p-2.5 sm:p-3 md:p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 md:gap-3 mb-1.5 sm:mb-2">
                    <p className="font-medium text-slate-900 text-sm sm:text-base">{leave.employee_name}</p>
                    <Badge className={`${getStatusBadge(leave.status)} text-[10px] sm:text-xs`}>{getStatusText(leave.status)}</Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1.5 sm:mb-2">
                    {leave.leave_type} - {leave.days_count} day{leave.days_count !== 1 ? 's' : ''}
                    {leave.is_half_day && (
                      <span className="hidden sm:inline"> • Half Day ({leave.half_day_period})</span>
                    )}
                  </p>
                  {leave.is_half_day && (
                    <p className="text-[10px] text-slate-500 mb-1.5 sm:hidden">
                      Half Day ({leave.half_day_period})
                    </p>
                  )}
                  {/* Individual Dates Display */}
                  {leave.dates && leave.dates.length > 0 && (
                    <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-1.5 sm:mt-2">
                      {leave.dates
                        .map(d => new Date(d))
                        .sort((a, b) => a - b)
                        .map((date, idx) => (
                          <Badge
                            key={idx}
                            variant="outline"
                            className="text-[10px] sm:text-xs bg-white text-slate-600 border-slate-300 py-0.5 px-1.5 sm:px-2"
                          >
                            <span className="sm:hidden">{format(date, 'MMM dd')}</span>
                            <span className="hidden sm:inline">{format(date, 'EEE, MMM dd')}</span>
                          </Badge>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 sm:py-8 text-slate-500">
              <FileText className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-3 text-slate-300" />
              <p className="text-sm sm:text-base">No recent leaves found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardPage;
