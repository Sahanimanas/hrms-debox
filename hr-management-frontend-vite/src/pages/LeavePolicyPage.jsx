import React, { useState, useEffect } from 'react';
import { Settings, Save, RefreshCw, AlertCircle, Users, CheckCircle, Plus, Trash2, Calendar, Clock, Ban, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import api from '@/lib/api';

const LeavePolicyPage = () => {
  const [policy, setPolicy] = useState({ policies: [], clubbing_rules: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingToAll, setApplyingToAll] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [activeTab, setActiveTab] = useState('policies');

  // Default new policy item
  const getDefaultPolicyItem = (order) => ({
    leave_type: `New Leave Type`,
    annual_quota: 12,
    order: order,
    credit_type: 'annually',
    monthly_credit: 0,
    advance_days_required: 0,
    encashment_allowed: false,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    clubbing_allowed_with: [],
    clubbing_not_allowed_with: [],
    is_unlimited: false
  });

  useEffect(() => {
    loadLeavePolicy();
  }, []);

  const loadLeavePolicy = async () => {
    setLoading(true);
    try {
      const response = await api.get('/leaves/leave-policy');

      // Ensure all policies have the new fields
      const policies = (response.data.policies || []).map((p, idx) => ({
        leave_type: p.leave_type || '',
        annual_quota: p.annual_quota ?? 0,
        order: p.order ?? idx + 1,
        credit_type: p.credit_type || 'annually',
        monthly_credit: p.monthly_credit ?? 0,
        advance_days_required: p.advance_days_required ?? 0,
        encashment_allowed: p.encashment_allowed ?? false,
        carry_forward_allowed: p.carry_forward_allowed ?? false,
        max_carry_forward_days: p.max_carry_forward_days ?? 0,
        clubbing_allowed_with: p.clubbing_allowed_with || [],
        clubbing_not_allowed_with: p.clubbing_not_allowed_with || [],
        is_unlimited: p.is_unlimited ?? false
      }));

      setPolicy({
        ...response.data,
        policies,
        clubbing_rules: response.data.clubbing_rules || []
      });

      if (response.data.updated_at) {
        setLastSaved(new Date(response.data.updated_at));
      }
    } catch (error) {
      console.error('Failed to load leave policy:', error);
      toast.error('Failed to load leave policy');
      // Set default policy
      setPolicy({
        policies: [
          {
            leave_type: 'Earned Leave',
            annual_quota: 12,
            order: 1,
            credit_type: 'monthly',
            monthly_credit: 1,
            advance_days_required: 7,
            encashment_allowed: true,
            carry_forward_allowed: true,
            max_carry_forward_days: 30,
            clubbing_allowed_with: ['Sick Leave'],
            clubbing_not_allowed_with: []
          },
          {
            leave_type: 'Sick Leave',
            annual_quota: 6,
            order: 2,
            credit_type: 'monthly',
            monthly_credit: 0.5,
            advance_days_required: 0,
            encashment_allowed: false,
            carry_forward_allowed: false,
            max_carry_forward_days: 0,
            clubbing_allowed_with: ['Earned Leave', 'Sick Leave'],
            clubbing_not_allowed_with: ['Casual Leave']
          },
          {
            leave_type: 'Casual Leave',
            annual_quota: 6,
            order: 3,
            credit_type: 'annually',
            monthly_credit: 0,
            advance_days_required: 0,
            encashment_allowed: false,
            carry_forward_allowed: false,
            max_carry_forward_days: 0,
            clubbing_allowed_with: ['Earned Leave'],
            clubbing_not_allowed_with: ['Sick Leave']
          },
          {
            leave_type: 'Unpaid Leave',
            annual_quota: 0,
            order: 4,
            credit_type: 'annually',
            monthly_credit: 0,
            advance_days_required: 0,
            encashment_allowed: false,
            carry_forward_allowed: false,
            max_carry_forward_days: 0,
            clubbing_allowed_with: [],
            clubbing_not_allowed_with: [],
            is_unlimited: true
          }
        ],
        clubbing_rules: [
          { leave_type_1: 'Sick Leave', leave_type_2: 'Earned Leave', allowed: true },
          { leave_type_1: 'Sick Leave', leave_type_2: 'Casual Leave', allowed: false },
          { leave_type_1: 'Sick Leave', leave_type_2: 'Sick Leave', allowed: true }
        ]
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Validate policies
      for (const p of policy.policies) {
        if (!p.leave_type.trim()) {
          toast.error('Leave type name cannot be empty');
          setSaving(false);
          return;
        }
        if (p.credit_type === 'monthly' && p.monthly_credit <= 0) {
          toast.error(`Please set monthly credit for ${p.leave_type}`);
          setSaving(false);
          return;
        }
      }

      await api.post('/leaves/leave-policy', policy);
      setLastSaved(new Date());
      toast.success('Leave policy updated successfully!');
      await loadLeavePolicy();
    } catch (error) {
      console.error('Failed to save policy:', error);
      toast.error(error.response?.data?.detail || 'Failed to update leave policy');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyToAll = async () => {
    if (!window.confirm('This will update leave balances for ALL employees based on the current policy and their joining dates. Are you sure?')) {
      return;
    }

    setApplyingToAll(true);
    try {
      const response = await api.post('/leaves/leave-policy/apply-to-all');
      toast.success(response.data.message);
    } catch (error) {
      console.error('Failed to apply policy:', error);
      toast.error(error.response?.data?.detail || 'Failed to apply policy to employees');
    } finally {
      setApplyingToAll(false);
    }
  };

  const updatePolicy = (index, field, value) => {
    const newPolicies = [...policy.policies];
    newPolicies[index] = { ...newPolicies[index], [field]: value };

    // Auto-calculate annual quota for monthly credit types
    if (field === 'monthly_credit' && newPolicies[index].credit_type === 'monthly') {
      newPolicies[index].annual_quota = parseFloat(value) * 12;
    }

    setPolicy({ ...policy, policies: newPolicies });
  };

  const addLeaveType = () => {
    const newPolicies = [...policy.policies];
    newPolicies.push(getDefaultPolicyItem(newPolicies.length + 1));
    setPolicy({ ...policy, policies: newPolicies });
  };

  const removeLeaveType = (index) => {
    const typeName = policy.policies[index].leave_type;
    if (!window.confirm(`Are you sure you want to remove "${typeName}"?`)) {
      return;
    }
    const newPolicies = policy.policies.filter((_, i) => i !== index);
    setPolicy({ ...policy, policies: newPolicies });
  };

  const toggleClubbingRule = (index, targetType) => {
    const newPolicies = [...policy.policies];
    const currentList = newPolicies[index].clubbing_not_allowed_with || [];

    if (currentList.includes(targetType)) {
      newPolicies[index].clubbing_not_allowed_with = currentList.filter(t => t !== targetType);
    } else {
      newPolicies[index].clubbing_not_allowed_with = [...currentList, targetType];
    }

    setPolicy({ ...policy, policies: newPolicies });
  };

  const getTotalDays = () => {
    return policy.policies.reduce((sum, p) => sum + (p.annual_quota || 0), 0);
  };

  const getLeaveTypeColors = (index) => {
    const colors = [
      { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-800' },
      { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', badge: 'bg-red-100 text-red-800' },
      { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-800' },
      { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-800' },
      { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', badge: 'bg-purple-100 text-purple-800' },
      { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-900', badge: 'bg-pink-100 text-pink-800' },
    ];
    return colors[index % colors.length];
  };

  if (loading) {
    return (
      <div className="p-6 md:p-10 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading leave policy...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Leave Policy Settings
          </h1>
          <p className="text-lg text-slate-600">Configure leave types, credits, and rules</p>
          {lastSaved && (
            <p className="text-sm text-slate-500 mt-1">
              Last saved: {lastSaved.toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={loadLeavePolicy}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="policies" className="gap-2">
            <Calendar className="w-4 h-4" />
            Leave Types
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-2">
            <ArrowRightLeft className="w-4 h-4" />
            Clubbing Rules
          </TabsTrigger>
        </TabsList>

        {/* Leave Types Tab */}
        <TabsContent value="policies" className="space-y-6">
          <form onSubmit={handleSave}>
            {/* Policy Cards */}
            <div className="grid gap-6">
              {policy.policies.length === 0 ? (
                <Card className="border-slate-200">
                  <CardContent className="py-12 text-center">
                    <Calendar className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                    <p className="text-slate-500 mb-4">No leave types configured.</p>
                    <Button type="button" onClick={addLeaveType}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add First Leave Type
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                policy.policies.map((policyItem, index) => {
                  const colors = getLeaveTypeColors(index);

                  return (
                    <Card key={index} className={`${colors.border} border-2`}>
                      <CardHeader className={`${colors.bg} border-b ${colors.border}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge className={colors.badge}>#{index + 1}</Badge>
                            <Input
                              type="text"
                              value={policyItem.leave_type}
                              onChange={(e) => updatePolicy(index, 'leave_type', e.target.value)}
                              className="text-lg font-semibold bg-white border-0 shadow-sm max-w-xs"
                              placeholder="Leave Type Name"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLeaveType(index)}
                            className="text-red-600 hover:text-red-800 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6 space-y-6">
                        {/* Unlimited Toggle */}
                        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-amber-50 rounded-lg border-2 border-purple-200">
                          <div>
                            <Label className="font-semibold text-base">Unlimited Leave</Label>
                            <p className="text-xs text-slate-600 mt-1">
                              No balance checking - employees can take as many days as needed
                            </p>
                          </div>
                          <Switch
                            checked={policyItem.is_unlimited || false}
                            onCheckedChange={(checked) => updatePolicy(index, 'is_unlimited', checked)}
                          />
                        </div>

                        {/* Credit Type Selection - Only show if not unlimited */}
                        {!policyItem.is_unlimited && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <Label className="text-base font-semibold flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Credit Type
                              </Label>
                              <Select
                                value={policyItem.credit_type}
                                onValueChange={(value) => {
                                  updatePolicy(index, 'credit_type', value);
                                  if (value === 'annually') {
                                    updatePolicy(index, 'monthly_credit', 0);
                                  }
                                }}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="monthly">
                                    <div className="flex items-center gap-2">
                                      <span>📅 Monthly Credit</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="annually">
                                    <div className="flex items-center gap-2">
                                      <span>📆 Annual Credit</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-slate-500">
                                {policyItem.credit_type === 'monthly'
                                  ? 'Leaves are credited every month based on joining date'
                                  : 'Full quota credited at the start of year/joining'}
                              </p>
                            </div>

                            {/* Quota / Monthly Credit */}
                            <div className="space-y-3">
                              {policyItem.credit_type === 'monthly' ? (
                                <>
                                  <Label className="text-base font-semibold">Monthly Credit (days/month)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={policyItem.monthly_credit}
                                    onChange={(e) => updatePolicy(index, 'monthly_credit', parseFloat(e.target.value) || 0)}
                                    className="bg-white"
                                  />
                                  <p className="text-xs text-slate-500">
                                    Annual quota: {(policyItem.monthly_credit || 0) * 12} days/year
                                  </p>
                                </>
                              ) : (
                                <>
                                  <Label className="text-base font-semibold">Annual Quota (days/year)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={policyItem.annual_quota}
                                    onChange={(e) => updatePolicy(index, 'annual_quota', parseFloat(e.target.value) || 0)}
                                    className="bg-white"
                                  />
                                  <p className="text-xs text-slate-500">
                                    {policyItem.annual_quota} days credited at start
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Advance Notice */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <Label className="text-base font-semibold flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              Advance Notice Required (days)
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              value={policyItem.advance_days_required}
                              onChange={(e) => updatePolicy(index, 'advance_days_required', parseInt(e.target.value) || 0)}
                              className="bg-white"
                            />
                            <p className="text-xs text-slate-500">
                              {policyItem.advance_days_required > 0
                                ? `Employee must apply ${policyItem.advance_days_required} days before leave date`
                                : 'No advance notice required'}
                            </p>
                          </div>

                          {/* Max Carry Forward */}
                          {policyItem.carry_forward_allowed && (
                            <div className="space-y-3">
                              <Label className="text-base font-semibold">Max Carry Forward (days)</Label>
                              <Input
                                type="number"
                                min="0"
                                value={policyItem.max_carry_forward_days}
                                onChange={(e) => updatePolicy(index, 'max_carry_forward_days', parseInt(e.target.value) || 0)}
                                className="bg-white"
                              />
                              <p className="text-xs text-slate-500">
                                Maximum days that can be carried to next year
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Toggles - Only show if not unlimited */}
                        {!policyItem.is_unlimited && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
                            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                              <div>
                                <Label className="font-medium">Encashment Allowed</Label>
                                <p className="text-xs text-slate-500 mt-1">
                                  Can unused leaves be converted to cash?
                                </p>
                              </div>
                              <Switch
                                checked={policyItem.encashment_allowed}
                                onCheckedChange={(checked) => updatePolicy(index, 'encashment_allowed', checked)}
                              />
                            </div>

                            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                              <div>
                                <Label className="font-medium">Carry Forward Allowed</Label>
                                <p className="text-xs text-slate-500 mt-1">
                                  Can unused leaves be carried to next year?
                                </p>
                              </div>
                              <Switch
                                checked={policyItem.carry_forward_allowed}
                                onCheckedChange={(checked) => updatePolicy(index, 'carry_forward_allowed', checked)}
                              />
                            </div>
                          </div>
                        )}

                        {/* Clubbing Rules */}
                        <div className="pt-4 border-t border-slate-200">
                          <Label className="text-base font-semibold flex items-center gap-2 mb-3">
                            <Ban className="w-4 h-4" />
                            Cannot be clubbed with:
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {policy.policies
                              .filter((_, i) => i !== index)
                              .map((otherPolicy) => {
                                const isBlocked = (policyItem.clubbing_not_allowed_with || []).includes(otherPolicy.leave_type);
                                return (
                                  <Badge
                                    key={otherPolicy.leave_type}
                                    variant={isBlocked ? "destructive" : "outline"}
                                    className={`cursor-pointer transition-all ${isBlocked ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'hover:bg-slate-100'}`}
                                    onClick={() => toggleClubbingRule(index, otherPolicy.leave_type)}
                                  >
                                    {isBlocked && <Ban className="w-3 h-3 mr-1" />}
                                    {otherPolicy.leave_type}
                                  </Badge>
                                );
                              })}
                          </div>
                          <p className="text-xs text-slate-500 mt-2">
                            Click on a leave type to toggle clubbing restriction
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {/* Add Leave Type Button */}
            {policy.policies.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={addLeaveType}
                className="w-full mt-6 gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Another Leave Type
              </Button>
            )}

            {/* Save Actions */}
            <Card className="mt-6 border-slate-200">
              <CardContent className="p-6">
                {/* Info Box */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                  <div className="flex gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <p className="font-semibold mb-2">How Leave Policy Works:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li><strong>Save Policy</strong> - Saves the configuration (required first)</li>
                        <li><strong>Apply to All</strong> - Updates all existing employees based on joining date</li>
                        <li>For <strong>Monthly Credit</strong>: Balance = months since joining × monthly credit</li>
                        <li>For <strong>Annual Credit</strong>: Full quota assigned immediately</li>
                        <li>New employees automatically get balances based on this policy</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Button
                    type="submit"
                    data-testid="save-policy-btn"
                    className="bg-slate-800 hover:bg-slate-900 gap-2"
                    disabled={saving}
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Leave Policy'}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleApplyToAll}
                    className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                    disabled={applyingToAll}
                  >
                    <Users className={`w-4 h-4 ${applyingToAll ? 'animate-pulse' : ''}`} />
                    {applyingToAll ? 'Applying...' : 'Apply to All Employees'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </TabsContent>

        {/* Clubbing Rules Tab */}
        <TabsContent value="rules" className="space-y-6">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5" />
                Leave Clubbing Rules Matrix
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 mb-4">
                This matrix shows which leave types can be combined (clubbed) together.
                Red indicates clubbing is NOT allowed.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="p-3 text-left bg-slate-50 border border-slate-200"></th>
                      {policy.policies.map((p) => (
                        <th key={p.leave_type} className="p-3 text-center bg-slate-50 border border-slate-200 text-sm font-medium">
                          {p.leave_type}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {policy.policies.map((rowPolicy, rowIndex) => (
                      <tr key={rowPolicy.leave_type}>
                        <td className="p-3 bg-slate-50 border border-slate-200 font-medium text-sm">
                          {rowPolicy.leave_type}
                        </td>
                        {policy.policies.map((colPolicy, colIndex) => {
                          const isBlocked = (rowPolicy.clubbing_not_allowed_with || []).includes(colPolicy.leave_type) ||
                            (colPolicy.clubbing_not_allowed_with || []).includes(rowPolicy.leave_type);
                          const isSame = rowIndex === colIndex;

                          return (
                            <td
                              key={colPolicy.leave_type}
                              className={`p-3 text-center border border-slate-200 ${isSame
                                  ? 'bg-slate-100'
                                  : isBlocked
                                    ? 'bg-red-50'
                                    : 'bg-green-50'
                                }`}
                            >
                              {isSame ? (
                                <span className="text-slate-400">—</span>
                              ) : isBlocked ? (
                                <Ban className="w-4 h-4 text-red-500 mx-auto" />
                              ) : (
                                <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-6 mt-4 pt-4 border-t border-slate-200">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 bg-green-50 border border-green-200 rounded"></div>
                  <span>Clubbing Allowed</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 bg-red-50 border border-red-200 rounded"></div>
                  <span>Clubbing Not Allowed</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Policy Summary */}
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle>Policy Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Total Leave Types</p>
                  <p className="text-2xl font-bold text-slate-900">{policy.policies.length}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Total Annual Days</p>
                  <p className="text-2xl font-bold text-slate-900">{getTotalDays()}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Monthly Credit Types</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {policy.policies.filter(p => p.credit_type === 'monthly').length}
                  </p>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500">Annual Credit Types</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {policy.policies.filter(p => p.credit_type === 'annually').length}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {policy.policies.map((p, idx) => {
                  const colors = getLeaveTypeColors(idx);
                  return (
                    <div key={p.leave_type} className={`p-3 rounded-lg border ${colors.border} ${colors.bg}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className={`font-medium ${colors.text}`}>{p.leave_type}</span>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {p.credit_type === 'monthly' ? `${p.monthly_credit}/month` : `${p.annual_quota}/year`}
                            </Badge>
                            {p.advance_days_required > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {p.advance_days_required}d advance
                              </Badge>
                            )}
                            {p.encashment_allowed && (
                              <Badge className="text-xs bg-green-100 text-green-800">Encashable</Badge>
                            )}
                            {p.carry_forward_allowed && (
                              <Badge className="text-xs bg-amber-100 text-amber-800">Carry Forward</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-2xl font-bold ${colors.text}`}>{p.annual_quota}</span>
                          <p className="text-xs text-slate-500">days/year</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default LeavePolicyPage;
