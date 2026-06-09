import React, { useState, useEffect } from 'react';
import {
  Receipt, CheckCircle, XCircle, Clock, Send, AlertCircle, Search,
  Filter, DollarSign, Users, FileText, Eye, Image, User, X,
  CheckSquare, Square, ChevronDown, Mail, Phone, Briefcase
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import api from '@/lib/api';
import { format } from 'date-fns';

const AdminReimbursementsPage = () => {
  const [reimbursements, setReimbursements] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReimbursement, setSelectedReimbursement] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [adminRemarks, setAdminRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  // Employee filter state
  const [selectedEmployeeEmail, setSelectedEmployeeEmail] = useState('all');
  const [showEmployeePanel, setShowEmployeePanel] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkActionModal, setShowBulkActionModal] = useState(false);
  const [bulkActionType, setBulkActionType] = useState('');

  useEffect(() => {
    fetchReimbursements();
    fetchEmployees();
  }, []);

  const fetchReimbursements = async () => {
    try {
      setLoading(true);
      const response = await api.get('/reimbursements/all');
      setReimbursements(response.data || []);
    } catch (error) {
      toast.error('Failed to load reimbursements');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      setEmployees(response.data || []);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
    }
  };

  // Get unique employees who have reimbursements
  const getEmployeesWithReimbursements = () => {
    const employeeMap = new Map();
    reimbursements.forEach(r => {
      if (r.employee_email && !employeeMap.has(r.employee_email)) {
        employeeMap.set(r.employee_email, {
          email: r.employee_email,
          name: r.employee_name,
          count: reimbursements.filter(x => x.employee_email === r.employee_email).length,
          pendingCount: reimbursements.filter(x => x.employee_email === r.employee_email && x.status === 'pending').length,
          totalAmount: reimbursements
            .filter(x => x.employee_email === r.employee_email)
            .reduce((sum, x) => sum + (parseFloat(x.amount) || 0), 0)
        });
      }
    });
    return Array.from(employeeMap.values());
  };

  const getFilteredReimbursements = () => {
    let filtered = reimbursements;

    // Filter by selected employee
    if (selectedEmployeeEmail && selectedEmployeeEmail !== 'all') {
      filtered = filtered.filter(r => r.employee_email === selectedEmployeeEmail);
    }

    // Filter by tab
    if (activeTab !== 'all') {
      filtered = filtered.filter(r => r.status === activeTab);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.title?.toLowerCase().includes(query) ||
        r.employee_name?.toLowerCase().includes(query) ||
        r.category?.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  const getStats = () => {
    // Use filtered by employee if selected
    let data = reimbursements;
    if (selectedEmployeeEmail && selectedEmployeeEmail !== 'all') {
      data = reimbursements.filter(r => r.employee_email === selectedEmployeeEmail);
    }

    const pending = data.filter(r => r.status === 'pending');
    const approved = data.filter(r => r.status === 'approved');
    const cleared = data.filter(r => r.status === 'cleared');
    const rejected = data.filter(r => r.status === 'rejected');

    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
      approvedCount: approved.length,
      approvedAmount: approved.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
      clearedCount: cleared.length,
      clearedAmount: cleared.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
      rejectedCount: rejected.length,
      rejectedAmount: rejected.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
      totalCount: data.length,
      totalAmount: data.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
    };
  };

  // Get selected employee details
  const getSelectedEmployeeDetails = () => {
    if (!selectedEmployeeEmail || selectedEmployeeEmail === 'all') return null;
    const emp = employees.find(e => e.email === selectedEmployeeEmail);
    const reimbData = reimbursements.filter(r => r.employee_email === selectedEmployeeEmail);
    return {
      ...emp,
      reimbursementCount: reimbData.length,
      totalAmount: reimbData.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
    };
  };

  const handleAction = (reimbursement, action) => {
    setSelectedReimbursement(reimbursement);
    setActionType(action);
    setAdminRemarks('');
    setShowActionModal(true);
  };

  const processAction = async () => {
    if (!selectedReimbursement) return;

    setProcessing(true);
    try {
      await api.post(`/reimbursements/${selectedReimbursement.id}/action`, {
        action: actionType,
        remarks: adminRemarks
      });

      const actionMessages = {
        approve: 'Reimbursement approved successfully',
        reject: 'Reimbursement rejected',
        clear: 'Reimbursement cleared and email sent to employee'
      };

      toast.success(actionMessages[actionType] || 'Action completed');
      setShowActionModal(false);
      fetchReimbursements();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Action failed');
    } finally {
      setProcessing(false);
    }
  };

  // Bulk selection handlers
  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const filteredIds = getFilteredReimbursements()
      .filter(r => {
        // Only allow selection of actionable items
        if (bulkActionType === 'approve' || bulkActionType === 'reject') {
          return r.status === 'pending';
        }
        if (bulkActionType === 'clear') {
          return r.status === 'approved';
        }
        return r.status === 'pending' || r.status === 'approved';
      })
      .map(r => r.id);

    if (selectedIds.length === filteredIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredIds);
    }
  };

  const getSelectableItems = () => {
    return getFilteredReimbursements().filter(r =>
      r.status === 'pending' || r.status === 'approved'
    );
  };

  const handleBulkAction = (action) => {
    if (selectedIds.length === 0) {
      toast.error('Please select at least one request');
      return;
    }
    setBulkActionType(action);
    setAdminRemarks('');
    setShowBulkActionModal(true);
  };

  const processBulkAction = async () => {
    if (selectedIds.length === 0) return;

    setProcessing(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const id of selectedIds) {
        try {
          await api.post(`/reimbursements/${id}/action`, {
            action: bulkActionType,
            remarks: adminRemarks
          });
          successCount++;
        } catch (error) {
          errorCount++;
          console.error(`Failed to process ${id}:`, error);
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully processed ${successCount} request(s)`);
      }
      if (errorCount > 0) {
        toast.error(`Failed to process ${errorCount} request(s)`);
      }

      setShowBulkActionModal(false);
      setSelectedIds([]);
      fetchReimbursements();
    } catch (error) {
      toast.error('Bulk action failed');
    } finally {
      setProcessing(false);
    }
  };

  const clearEmployeeFilter = () => {
    setSelectedEmployeeEmail('all');
    setSelectedIds([]);
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
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 gap-1">
            <CheckCircle className="w-3 h-3" />
            Approved
          </Badge>
        );
      case 'cleared':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
            <CheckCircle className="w-3 h-3" />
            Cleared
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

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getAvatarColor = (name) => {
    const colors = [
      'from-slate-900 to-slate-800',
      'from-emerald-500 to-emerald-600',
      'from-purple-500 to-purple-600',
      'from-amber-500 to-amber-600',
      'from-rose-500 to-rose-600',
      'from-cyan-500 to-cyan-600',
      'from-slate-800 to-slate-800',
      'from-pink-500 to-pink-600',
    ];
    if (!name) return colors[0];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  };

  const stats = getStats();
  const filteredReimbursements = getFilteredReimbursements();
  const employeesWithReimbursements = getEmployeesWithReimbursements();
  const selectedEmployeeDetails = getSelectedEmployeeDetails();
  const selectableItems = getSelectableItems();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-slate-800 rounded-xl shadow-lg">
                <Receipt className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                  Reimbursement Management
                </h1>
                <p className="text-slate-600">Review and process employee reimbursement requests</p>
              </div>
            </div>
            <Button
              variant={showEmployeePanel ? 'default' : 'outline'}
              onClick={() => setShowEmployeePanel(!showEmployeePanel)}
              className={showEmployeePanel ? 'bg-slate-800 hover:bg-slate-900' : ''}
            >
              <Users className="w-4 h-4 mr-2" />
              Filter by Employee
            </Button>
          </div>
        </div>

        {/* Employee Selection Panel */}
        {showEmployeePanel && (
          <Card className="border-0 shadow-md mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-600" />
                Select Employee to View Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {/* All Employees Option */}
                <div
                  onClick={clearEmployeeFilter}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedEmployeeEmail === 'all'
                      ? 'border-slate-800 bg-slate-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white font-bold mb-2">
                      <Users className="w-6 h-6" />
                    </div>
                    <p className="font-medium text-slate-900 text-sm">All Employees</p>
                    <p className="text-xs text-slate-500">{reimbursements.length} requests</p>
                  </div>
                </div>

                {/* Individual Employees */}
                {employeesWithReimbursements.map((emp) => (
                  <div
                    key={emp.email}
                    onClick={() => {
                      setSelectedEmployeeEmail(emp.email);
                      setSelectedIds([]);
                    }}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedEmployeeEmail === emp.email
                        ? 'border-slate-800 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                  >
                    <div className="flex flex-col items-center text-center">
                      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getAvatarColor(emp.name)} flex items-center justify-center text-white font-bold mb-2`}>
                        {getInitials(emp.name)}
                      </div>
                      <p className="font-medium text-slate-900 text-sm truncate w-full">{emp.name}</p>
                      <p className="text-xs text-slate-500">{emp.count} requests</p>
                      {emp.pendingCount > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-xs mt-1">
                          {emp.pendingCount} pending
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Selected Employee Info Card */}
        {selectedEmployeeDetails && (
          <Card className="border-0 shadow-md mb-6 bg-gradient-to-r from-slate-800 to-slate-900 text-white">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${getAvatarColor(selectedEmployeeDetails.full_name)} flex items-center justify-center text-white text-xl font-bold ring-4 ring-white/20`}>
                    {getInitials(selectedEmployeeDetails.full_name)}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">{selectedEmployeeDetails.full_name}</h2>
                    <div className="flex items-center gap-4 mt-1 text-slate-300">
                      <span className="flex items-center gap-1">
                        <Mail className="w-4 h-4" />
                        {selectedEmployeeDetails.email}
                      </span>
                      {selectedEmployeeDetails.department && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          {selectedEmployeeDetails.department}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-300">Total Reimbursements</p>
                  <p className="text-3xl font-bold">₹{stats.totalAmount.toLocaleString()}</p>
                  <p className="text-sm text-slate-400">{stats.totalCount} requests</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearEmployeeFilter}
                  className="text-white hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium">Pending</p>
                  <p className="text-2xl font-bold text-amber-700">₹{stats.pendingAmount.toLocaleString()}</p>
                  <p className="text-xs text-amber-600 mt-1">{stats.pendingCount} requests</p>
                </div>
                <div className="p-3 bg-amber-200 rounded-xl">
                  <Clock className="w-6 h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-amber-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium">Approved (To Clear)</p>
                  <p className="text-2xl font-bold text-amber-700">₹{stats.approvedAmount.toLocaleString()}</p>
                  <p className="text-xs text-amber-600 mt-1">{stats.approvedCount} requests</p>
                </div>
                <div className="p-3 bg-amber-200 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-green-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-600 font-medium">Cleared</p>
                  <p className="text-2xl font-bold text-emerald-700">₹{stats.clearedAmount.toLocaleString()}</p>
                  <p className="text-xs text-emerald-600 mt-1">{stats.clearedCount} requests</p>
                </div>
                <div className="p-3 bg-emerald-200 rounded-xl">
                  <CheckCircle className="w-6 h-6 text-emerald-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md bg-gradient-to-br from-purple-50 to-violet-50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-600 font-medium">Total Requests</p>
                  <p className="text-2xl font-bold text-purple-700">{stats.totalCount}</p>
                  <p className="text-xs text-purple-600 mt-1">₹{stats.totalAmount.toLocaleString()} total</p>
                </div>
                <div className="p-3 bg-purple-200 rounded-xl">
                  <FileText className="w-6 h-6 text-purple-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <CardTitle className="text-xl">
                {selectedEmployeeEmail !== 'all'
                  ? `Requests from ${employeesWithReimbursements.find(e => e.email === selectedEmployeeEmail)?.name || 'Employee'}`
                  : 'All Reimbursement Requests'
                }
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search by name, title..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedIds([]); }}>
              <div className="px-6 pt-4 border-b border-slate-100">
                <div className="flex items-center justify-between">
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
                      {stats.approvedCount > 0 && (
                        <Badge className="bg-slate-900 text-white ml-1">{stats.approvedCount}</Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="cleared" className="gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Cleared
                    </TabsTrigger>
                    <TabsTrigger value="rejected" className="gap-2">
                      <XCircle className="w-4 h-4" />
                      Rejected
                    </TabsTrigger>
                    <TabsTrigger value="all">All</TabsTrigger>
                  </TabsList>

                  {/* Bulk Action Buttons */}
                  {selectableItems.length > 0 && (
                    <div className="flex items-center gap-2">
                      {selectedIds.length > 0 && (
                        <span className="text-sm text-slate-500">
                          {selectedIds.length} selected
                        </span>
                      )}
                      {activeTab === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBulkAction('approve')}
                            disabled={selectedIds.length === 0}
                            className="gap-1"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Bulk Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBulkAction('reject')}
                            disabled={selectedIds.length === 0}
                            className="gap-1 text-red-600 hover:text-red-700"
                          >
                            <XCircle className="w-4 h-4" />
                            Bulk Reject
                          </Button>
                        </>
                      )}
                      {activeTab === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleBulkAction('clear')}
                          disabled={selectedIds.length === 0}
                          className="gap-1 text-emerald-600 hover:text-emerald-700"
                        >
                          <Send className="w-4 h-4" />
                          Bulk Clear
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6">
                {loading ? (
                  <div className="text-center py-16">
                    <div className="animate-spin w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-4"></div>
                    <p className="text-slate-500">Loading reimbursements...</p>
                  </div>
                ) : filteredReimbursements.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Receipt className="w-10 h-10 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">No Reimbursements Found</h3>
                    <p className="text-slate-500">
                      {searchQuery ? 'Try a different search term' : `No ${activeTab !== 'all' ? activeTab : ''} reimbursements`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Select All Header */}
                    {selectableItems.length > 0 && (activeTab === 'pending' || activeTab === 'approved') && (
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                        <Checkbox
                          checked={selectedIds.length === selectableItems.filter(r => r.status === activeTab).length && selectedIds.length > 0}
                          onCheckedChange={() => {
                            const tabItems = selectableItems.filter(r => r.status === activeTab).map(r => r.id);
                            if (selectedIds.length === tabItems.length) {
                              setSelectedIds([]);
                            } else {
                              setSelectedIds(tabItems);
                            }
                          }}
                        />
                        <span className="text-sm text-slate-600">
                          Select all {activeTab} requests ({selectableItems.filter(r => r.status === activeTab).length})
                        </span>
                      </div>
                    )}

                    {filteredReimbursements.map((reimbursement) => (
                      <div
                        key={reimbursement.id}
                        className={`border rounded-xl p-5 hover:shadow-md transition-shadow bg-white ${selectedIds.includes(reimbursement.id) ? 'border-slate-800 bg-slate-50' : 'border-slate-200'
                          }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex gap-4">
                            {/* Checkbox for selectable items */}
                            {(reimbursement.status === 'pending' || reimbursement.status === 'approved') && (
                              <div className="pt-1">
                                <Checkbox
                                  checked={selectedIds.includes(reimbursement.id)}
                                  onCheckedChange={() => toggleSelect(reimbursement.id)}
                                />
                              </div>
                            )}

                            <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getAvatarColor(reimbursement.employee_name)} flex items-center justify-center text-white font-bold`}>
                              {getInitials(reimbursement.employee_name)}
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-800 text-lg">{reimbursement.title}</h3>
                              <p className="text-sm text-slate-600">{reimbursement.employee_name}</p>
                              <div className="flex items-center gap-3 mt-2">
                                <Badge variant="outline" className="text-xs">
                                  {reimbursement.category}
                                </Badge>
                                <span className="text-sm text-slate-500">
                                  {format(new Date(reimbursement.expense_date), 'MMM dd, yyyy')}
                                </span>
                                {getStatusBadge(reimbursement.status)}
                              </div>
                              {reimbursement.description && (
                                <p className="text-sm text-slate-500 mt-2 max-w-xl">{reimbursement.description}</p>
                              )}
                              {reimbursement.admin_remarks && (
                                <div className="mt-2 p-2 bg-slate-50 rounded-lg max-w-xl">
                                  <p className="text-xs text-slate-500">
                                    <span className="font-medium">Remarks:</span> {reimbursement.admin_remarks}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-2xl font-bold text-slate-800">₹{parseFloat(reimbursement.amount).toLocaleString()}</p>

                            {reimbursement.bill_url && (
                              <a
                                href={reimbursement.bill_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 mt-2"
                              >
                                <Image className="w-3 h-3" />
                                View Bill
                              </a>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 mt-4 justify-end">
                              {reimbursement.status === 'pending' && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => handleAction(reimbursement, 'approve')}
                                    className="bg-slate-900 hover:bg-slate-800"
                                  >
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => handleAction(reimbursement, 'reject')}
                                  >
                                    <XCircle className="w-4 h-4 mr-1" />
                                    Reject
                                  </Button>
                                </>
                              )}
                              {reimbursement.status === 'approved' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleAction(reimbursement, 'clear')}
                                  className="bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <Send className="w-4 h-4 mr-1" />
                                  Clear & Send Email
                                </Button>
                              )}
                            </div>
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

        {/* Single Action Modal */}
        <Dialog open={showActionModal} onOpenChange={setShowActionModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {actionType === 'approve' && <CheckCircle className="w-5 h-5 text-amber-600" />}
                {actionType === 'reject' && <XCircle className="w-5 h-5 text-red-600" />}
                {actionType === 'clear' && <Send className="w-5 h-5 text-emerald-600" />}
                {actionType === 'approve' && 'Approve Reimbursement'}
                {actionType === 'reject' && 'Reject Reimbursement'}
                {actionType === 'clear' && 'Clear Reimbursement'}
              </DialogTitle>
            </DialogHeader>

            {selectedReimbursement && (
              <div className="py-4">
                <div className="p-4 bg-slate-50 rounded-xl mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-slate-800">{selectedReimbursement.title}</p>
                      <p className="text-sm text-slate-500">{selectedReimbursement.employee_name}</p>
                    </div>
                    <p className="text-xl font-bold text-slate-800">
                      ₹{parseFloat(selectedReimbursement.amount).toLocaleString()}
                    </p>
                  </div>
                </div>

                {actionType === 'clear' && (
                  <div className="p-4 bg-emerald-50 rounded-xl mb-4 border border-emerald-200">
                    <p className="text-sm text-emerald-700">
                      <strong>Note:</strong> An email notification will be sent to {selectedReimbursement.employee_email || selectedReimbursement.employee_name} confirming that their reimbursement has been cleared.
                    </p>
                  </div>
                )}

                <div>
                  <Label className="text-slate-700 font-medium">
                    Remarks {actionType === 'reject' ? '*' : '(Optional)'}
                  </Label>
                  <Textarea
                    placeholder={
                      actionType === 'reject'
                        ? 'Please provide a reason for rejection...'
                        : 'Add any remarks or notes...'
                    }
                    value={adminRemarks}
                    onChange={(e) => setAdminRemarks(e.target.value)}
                    className="mt-1.5"
                    rows={3}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowActionModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={processAction}
                disabled={processing || (actionType === 'reject' && !adminRemarks.trim())}
                className={
                  actionType === 'approve' ? 'bg-slate-900 hover:bg-slate-800' :
                    actionType === 'reject' ? 'bg-red-600 hover:bg-red-700' :
                      'bg-emerald-600 hover:bg-emerald-700'
                }
              >
                {processing ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    {actionType === 'approve' && 'Approve'}
                    {actionType === 'reject' && 'Reject'}
                    {actionType === 'clear' && 'Clear & Send Email'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Action Modal */}
        <Dialog open={showBulkActionModal} onOpenChange={setShowBulkActionModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {bulkActionType === 'approve' && <CheckCircle className="w-5 h-5 text-amber-600" />}
                {bulkActionType === 'reject' && <XCircle className="w-5 h-5 text-red-600" />}
                {bulkActionType === 'clear' && <Send className="w-5 h-5 text-emerald-600" />}
                Bulk {bulkActionType === 'approve' ? 'Approve' : bulkActionType === 'reject' ? 'Reject' : 'Clear'} Reimbursements
              </DialogTitle>
            </DialogHeader>

            <div className="py-4">
              <div className="p-4 bg-slate-50 rounded-xl mb-4">
                <p className="font-semibold text-slate-800 mb-2">
                  {selectedIds.length} request(s) selected
                </p>
                <p className="text-2xl font-bold text-slate-800">
                  ₹{reimbursements
                    .filter(r => selectedIds.includes(r.id))
                    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
                    .toLocaleString()}
                </p>
                <p className="text-sm text-slate-500 mt-1">Total amount</p>
              </div>

              {bulkActionType === 'clear' && (
                <div className="p-4 bg-emerald-50 rounded-xl mb-4 border border-emerald-200">
                  <p className="text-sm text-emerald-700">
                    <strong>Note:</strong> Email notifications will be sent to all employees confirming their reimbursements have been cleared.
                  </p>
                </div>
              )}

              <div>
                <Label className="text-slate-700 font-medium">
                  Remarks {bulkActionType === 'reject' ? '*' : '(Optional)'}
                </Label>
                <Textarea
                  placeholder={
                    bulkActionType === 'reject'
                      ? 'Please provide a reason for rejection...'
                      : 'Add any remarks or notes (applies to all selected)...'
                  }
                  value={adminRemarks}
                  onChange={(e) => setAdminRemarks(e.target.value)}
                  className="mt-1.5"
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBulkActionModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={processBulkAction}
                disabled={processing || (bulkActionType === 'reject' && !adminRemarks.trim())}
                className={
                  bulkActionType === 'approve' ? 'bg-slate-900 hover:bg-slate-800' :
                    bulkActionType === 'reject' ? 'bg-red-600 hover:bg-red-700' :
                      'bg-emerald-600 hover:bg-emerald-700'
                }
              >
                {processing ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Processing {selectedIds.length} requests...
                  </>
                ) : (
                  <>
                    {bulkActionType === 'approve' && `Approve ${selectedIds.length} Requests`}
                    {bulkActionType === 'reject' && `Reject ${selectedIds.length} Requests`}
                    {bulkActionType === 'clear' && `Clear ${selectedIds.length} Requests`}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default AdminReimbursementsPage;
