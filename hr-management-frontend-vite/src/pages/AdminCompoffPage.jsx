import React, { useState, useEffect } from 'react';
import { Gift, Clock, CheckCircle, XCircle, Search, Calendar, Users, Filter, UserCheck, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const AdminCompOffPage = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [remarks, setRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await api.get('/comp-off/all-requests');
      setRequests(response.data || []);
    } catch (error) {
      toast.error('Failed to load comp-off requests');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredRequests = () => {
    let filtered = requests;

    // Filter by tab
    if (activeTab !== 'all') {
      filtered = filtered.filter(r => r.status === activeTab);
    }

    // Filter by role
    if (roleFilter !== 'all') {
      filtered = filtered.filter(r => r.employee_role === roleFilter);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.employee_name?.toLowerCase().includes(query) ||
        r.reason?.toLowerCase().includes(query) ||
        r.department?.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  const getStats = () => {
    const pending = requests.filter(r => r.status === 'pending');
    const approved = requests.filter(r => r.status === 'approved');

    return {
      pendingCount: pending.length,
      pendingEmployees: pending.filter(r => r.employee_role === 'employee').length,
      pendingManagers: pending.filter(r => r.employee_role === 'manager').length,
      approvedCount: approved.length,
      approvedDays: approved.reduce((sum, r) => sum + (r.days || 0), 0),
      rejectedCount: requests.filter(r => r.status === 'rejected').length,
      totalCount: requests.length
    };
  };

  const handleAction = (request, action) => {
    setSelectedRequest(request);
    setActionType(action);
    setRemarks('');
    setShowActionModal(true);
  };

  const processAction = async () => {
    if (!selectedRequest) return;

    if (actionType === 'reject' && !remarks.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }

    setProcessing(true);
    try {
      await api.post(`/comp-off/${selectedRequest.id}/action`, {
        action: actionType,
        remarks: remarks
      });

      toast.success(`Comp-off request ${actionType}d successfully`);
      setShowActionModal(false);
      fetchRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1">
            <Clock className="w-3 h-3" />
            Pending
          </Badge>
        );
      case 'approved':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
            <CheckCircle className="w-3 h-3" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1">
            <XCircle className="w-3 h-3" />
            Rejected
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'manager':
        return (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1">
            <Shield className="w-3 h-3" />
            Manager
          </Badge>
        );
      case 'employee':
        return (
          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 gap-1">
            <UserCheck className="w-3 h-3" />
            Employee
          </Badge>
        );
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const stats = getStats();
  const filteredRequests = getFilteredRequests();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-gradient-to-br from-violet-600 to-purple-700 rounded-xl shadow-lg">
              <Gift className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Comp-Off Management
              </h1>
              <p className="text-slate-600">Review and manage all comp-off requests</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium">Pending</p>
                  <p className="text-2xl font-bold text-amber-700">{stats.pendingCount}</p>
                  <p className="text-xs text-amber-600 mt-1">
                    {stats.pendingEmployees} emp, {stats.pendingManagers} mgr
                  </p>
                </div>
                <div className="p-3 bg-amber-200 rounded-xl">
                  <Clock className="w-5 h-5 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-green-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-600 font-medium">Approved</p>
                  <p className="text-2xl font-bold text-emerald-700">{stats.approvedCount}</p>
                  <p className="text-xs text-emerald-600 mt-1">{stats.approvedDays} days total</p>
                </div>
                <div className="p-3 bg-emerald-200 rounded-xl">
                  <CheckCircle className="w-5 h-5 text-emerald-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-red-50 to-rose-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-red-600 font-medium">Rejected</p>
                  <p className="text-2xl font-bold text-red-700">{stats.rejectedCount}</p>
                </div>
                <div className="p-3 bg-red-200 rounded-xl">
                  <XCircle className="w-5 h-5 text-red-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-amber-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium">From Managers</p>
                  <p className="text-2xl font-bold text-amber-700">
                    {requests.filter(r => r.employee_role === 'manager').length}
                  </p>
                </div>
                <div className="p-3 bg-amber-200 rounded-xl">
                  <Shield className="w-5 h-5 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-violet-50 to-purple-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-violet-600 font-medium">Total Requests</p>
                  <p className="text-2xl font-bold text-violet-700">{stats.totalCount}</p>
                </div>
                <div className="p-3 bg-violet-200 rounded-xl">
                  <Gift className="w-5 h-5 text-violet-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <CardTitle className="text-xl">All Comp-Off Requests</CardTitle>
              <div className="flex items-center gap-3">
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-40">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="employee">Employees</SelectItem>
                    <SelectItem value="manager">Managers</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="px-6 pt-4 border-b border-slate-100">
                <TabsList className="bg-slate-100">
                  <TabsTrigger value="pending" className="gap-2">
                    <Clock className="w-4 h-4" />
                    Pending
                    {stats.pendingCount > 0 && (
                      <Badge className="bg-amber-500 text-white ml-1">{stats.pendingCount}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="approved" className="gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Approved
                  </TabsTrigger>
                  <TabsTrigger value="rejected" className="gap-2">
                    <XCircle className="w-4 h-4" />
                    Rejected
                  </TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </div>

              <div className="p-6">
                {loading ? (
                  <div className="text-center py-16">
                    <div className="animate-spin w-10 h-10 border-4 border-slate-200 border-t-violet-600 rounded-full mx-auto mb-4"></div>
                    <p className="text-slate-500">Loading requests...</p>
                  </div>
                ) : filteredRequests.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Gift className="w-10 h-10 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">No Requests Found</h3>
                    <p className="text-slate-500">
                      {searchQuery || roleFilter !== 'all'
                        ? 'Try different filters'
                        : `No ${activeTab !== 'all' ? activeTab : ''} comp-off requests`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredRequests.map((request) => (
                      <div
                        key={request.id}
                        className={`border rounded-xl p-5 hover:shadow-md transition-shadow bg-white ${request.employee_role === 'manager'
                            ? 'border-amber-200 bg-gradient-to-r from-amber-50/30 to-white'
                            : 'border-slate-200'
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex gap-4">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold ${request.employee_role === 'manager'
                                ? 'bg-gradient-to-br from-slate-900 to-slate-900'
                                : 'bg-gradient-to-br from-violet-600 to-purple-700'
                              }`}>
                              {request.employee_name?.charAt(0) || '?'}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h3 className="font-semibold text-slate-800">{request.employee_name}</h3>
                                {getRoleBadge(request.employee_role)}
                                {getStatusBadge(request.status)}
                              </div>
                              <p className="text-sm text-slate-500 mb-2">
                                {request.department} • Worked on{' '}
                                <span className="font-medium text-slate-700">
                                  {format(new Date(request.work_date), 'EEEE, MMM dd, yyyy')}
                                </span>
                              </p>
                              <p className="text-sm text-slate-600 mb-2">{request.reason}</p>
                              <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span>Requested: {format(new Date(request.created_at), 'MMM dd, yyyy')}</span>
                                {request.approved_by && (
                                  <>
                                    <span>•</span>
                                    <span>By: {request.approved_by}</span>
                                  </>
                                )}
                              </div>
                              {request.remarks && (
                                <div className="mt-2 p-2 bg-slate-50 rounded-lg">
                                  <p className="text-xs text-slate-600">
                                    <span className="font-medium">Remarks:</span> {request.remarks}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-violet-700">{request.days}</p>
                            <p className="text-xs text-slate-500 mb-4">day{request.days !== 1 ? 's' : ''}</p>

                            {request.status === 'pending' && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleAction(request, 'approve')}
                                  className="bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleAction(request, 'reject')}
                                >
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            )}

                            {request.status === 'approved' && (
                              <div className="mt-2">
                                <p className="text-xs text-slate-500">Remaining</p>
                                <p className="text-lg font-semibold text-emerald-600">
                                  {request.remaining_days ?? request.days}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Tabs>
          </CardContent>
        </Card>

        {/* Action Modal */}
        <Dialog open={showActionModal} onOpenChange={setShowActionModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {actionType === 'approve' ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                {actionType === 'approve' ? 'Approve' : 'Reject'} Comp-Off Request
              </DialogTitle>
            </DialogHeader>

            {selectedRequest && (
              <div className="py-4">
                <div className="p-4 bg-slate-50 rounded-xl mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-slate-800">{selectedRequest.employee_name}</p>
                        {getRoleBadge(selectedRequest.employee_role)}
                      </div>
                      <p className="text-sm text-slate-500">
                        Worked on {format(new Date(selectedRequest.work_date), 'MMM dd, yyyy')}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">{selectedRequest.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-violet-700">
                        {selectedRequest.days} day{selectedRequest.days !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-slate-700 font-medium">
                    Remarks {actionType === 'reject' ? '*' : '(Optional)'}
                  </Label>
                  <Textarea
                    placeholder={
                      actionType === 'reject'
                        ? 'Please provide a reason for rejection...'
                        : 'Add any remarks...'
                    }
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="mt-1.5"
                    rows={3}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowActionModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={processAction}
                disabled={processing || (actionType === 'reject' && !remarks.trim())}
                className={actionType === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
              >
                {processing ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Processing...
                  </>
                ) : (
                  actionType === 'approve' ? 'Approve' : 'Reject'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default AdminCompOffPage;
