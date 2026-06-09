import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, DollarSign, MoveUp, MoveDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const SalaryTemplatePage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [earnings, setEarnings] = useState([]);
  const [deductions, setDeductions] = useState([]);

  useEffect(() => {
    fetchTemplate();
  }, []);

  const fetchTemplate = async () => {
    try {
      const response = await api.get('/salary-template');
      setEarnings(response.data.earnings || []);
      setDeductions(response.data.deductions || []);
    } catch (error) {
      toast.error('Failed to load salary template');
    } finally {
      setLoading(false);
    }
  };

  const addEarning = () => {
    const newOrder = earnings.length > 0 ? Math.max(...earnings.map(e => e.order)) + 1 : 1;
    setEarnings([...earnings, { name: '', order: newOrder }]);
  };

  const addDeduction = () => {
    const newOrder = deductions.length > 0 ? Math.max(...deductions.map(d => d.order)) + 1 : 1;
    setDeductions([...deductions, { name: '', order: newOrder }]);
  };

  const removeEarning = (index) => {
    setEarnings(earnings.filter((_, i) => i !== index));
  };

  const removeDeduction = (index) => {
    setDeductions(deductions.filter((_, i) => i !== index));
  };

  const updateEarning = (index, name) => {
    const updated = [...earnings];
    updated[index].name = name;
    setEarnings(updated);
  };

  const updateDeduction = (index, name) => {
    const updated = [...deductions];
    updated[index].name = name;
    setDeductions(updated);
  };

  const moveEarningUp = (index) => {
    if (index === 0) return;
    const updated = [...earnings];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setEarnings(updated);
  };

  const moveEarningDown = (index) => {
    if (index === earnings.length - 1) return;
    const updated = [...earnings];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setEarnings(updated);
  };

  const moveDeductionUp = (index) => {
    if (index === 0) return;
    const updated = [...deductions];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setDeductions(updated);
  };

  const moveDeductionDown = (index) => {
    if (index === deductions.length - 1) return;
    const updated = [...deductions];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setDeductions(updated);
  };

  const handleSave = async () => {
    // Validate
    const hasEmptyEarnings = earnings.some(e => !e.name.trim());
    const hasEmptyDeductions = deductions.some(d => !d.name.trim());

    if (hasEmptyEarnings || hasEmptyDeductions) {
      toast.error('Please fill in all component names');
      return;
    }

    // Update order based on array position
    const updatedEarnings = earnings.map((e, idx) => ({ ...e, order: idx + 1 }));
    const updatedDeductions = deductions.map((d, idx) => ({ ...d, order: idx + 1 }));

    setSaving(true);
    try {
      await api.post('/salary-template', {
        earnings: updatedEarnings,
        deductions: updatedDeductions
      });
      toast.success('Salary template saved successfully!');
      fetchTemplate();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Salary Structure Template
          </h1>
          <p className="text-slate-600">
            Define the standard salary components that will be used for all employees
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Earnings Card */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="bg-emerald-50 border-b border-emerald-100">
              <CardTitle className="flex items-center gap-2 text-emerald-800">
                <DollarSign className="w-5 h-5" />
                Earnings
                <Badge className="ml-auto bg-emerald-600">{earnings.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {earnings.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>No earnings components added yet</p>
                  <p className="text-sm mt-1">Click "Add Earning" to start</p>
                </div>
              ) : (
                earnings.map((earning, index) => (
                  <div
                    key={index}
                    className="border border-emerald-200 rounded-lg p-3 bg-emerald-50 flex items-center gap-2"
                  >
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveEarningUp(index)}
                        disabled={index === 0}
                        className="h-6 w-6 p-0"
                      >
                        <MoveUp className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveEarningDown(index)}
                        disabled={index === earnings.length - 1}
                        className="h-6 w-6 p-0"
                      >
                        <MoveDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="e.g., House Rent Allowance (HRA)"
                        value={earning.name}
                        onChange={(e) => updateEarning(index, e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeEarning(index)}
                      className="shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}

              <Button
                onClick={addEarning}
                variant="outline"
                className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Earning
              </Button>
            </CardContent>
          </Card>

          {/* Deductions Card */}
          <Card className="border-slate-100 shadow-sm">
            <CardHeader className="bg-red-50 border-b border-red-100">
              <CardTitle className="flex items-center gap-2 text-red-800">
                <DollarSign className="w-5 h-5" />
                Deductions
                <Badge className="ml-auto bg-red-600">{deductions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {deductions.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>No deduction components added yet</p>
                  <p className="text-sm mt-1">Click "Add Deduction" to start</p>
                </div>
              ) : (
                deductions.map((deduction, index) => (
                  <div
                    key={index}
                    className="border border-red-200 rounded-lg p-3 bg-red-50 flex items-center gap-2"
                  >
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveDeductionUp(index)}
                        disabled={index === 0}
                        className="h-6 w-6 p-0"
                      >
                        <MoveUp className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveDeductionDown(index)}
                        disabled={index === deductions.length - 1}
                        className="h-6 w-6 p-0"
                      >
                        <MoveDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="e.g., Employee Provident Fund (EPF)"
                        value={deduction.name}
                        onChange={(e) => updateDeduction(index, e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => removeDeduction(index)}
                      className="shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}

              <Button
                onClick={addDeduction}
                variant="outline"
                className="w-full border-red-300 text-red-700 hover:bg-red-50"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Deduction
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Info Card */}
        <Card className="mt-6 border-amber-100 bg-amber-50 shadow-sm">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <div className="text-amber-600 text-2xl">ℹ️</div>
              <div className="text-sm text-amber-900">
                <p className="font-semibold mb-2">About Salary Template</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>This template defines the structure of salary slips for all employees</li>
                  <li>The order of components will be reflected in generated salary slips</li>
                  <li>Use the up/down arrows to reorder components</li>
                  <li>
                    Examples of earnings: Basic Pay, HRA, DA, Conveyance Allowance, Special Allowance
                  </li>
                  <li>Examples of deductions: Professional Tax, TDS, EPF, Insurance</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-800 hover:bg-slate-900 px-8 py-6 text-lg"
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? 'Saving Template...' : 'Save Template'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SalaryTemplatePage;
