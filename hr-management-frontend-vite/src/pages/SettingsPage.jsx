import React, { useState, useEffect } from 'react';
import { Plus, X, Settings, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const SettingsPage = () => {
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [newDepartment, setNewDepartment] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newLeaveType, setNewLeaveType] = useState('');
  const [employeeIdPrefix, setEmployeeIdPrefix] = useState('EMP');
  const [employeeIdCounter, setEmployeeIdCounter] = useState(1000);
  const [savingEmployeeId, setSavingEmployeeId] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    // Load from localStorage
    const savedDepts = localStorage.getItem('departments');
    const savedDesigs = localStorage.getItem('designations');
    const savedLeaveTypes = localStorage.getItem('leave_types');
    
    setDepartments(savedDepts ? JSON.parse(savedDepts) : [
      'Engineering',
      'Human Resources',
      'Sales',
      'Marketing',
      'Finance',
      'Operations'
    ]);
    
    setDesignations(savedDesigs ? JSON.parse(savedDesigs) : [
      'Software Developer',
      'Senior Developer',
      'Team Lead',
      'Engineering Manager',
      'HR Manager',
      'Sales Executive',
      'Marketing Manager',
      'Finance Manager',
      'Operations Manager'
    ]);
    
    setLeaveTypes(savedLeaveTypes ? JSON.parse(savedLeaveTypes) : [
      'Sick Leave',
      'Casual Leave',
      'Paid Leave',
      'Unpaid Leave'
    ]);

    // Load employee ID settings from backend
    try {
      const response = await api.get('/employee-id-settings');
      setEmployeeIdPrefix(response.data.prefix || 'EMP');
      setEmployeeIdCounter(response.data.counter || 1000);
    } catch (error) {
      console.error('Failed to load employee ID settings:', error);
    }
  };

  const saveDepartments = (depts) => {
    localStorage.setItem('departments', JSON.stringify(depts));
    setDepartments(depts);
  };

  const saveDesignations = (desigs) => {
    localStorage.setItem('designations', JSON.stringify(desigs));
    setDesignations(desigs);
  };

  const addDepartment = () => {
    if (!newDepartment.trim()) {
      toast.error('Please enter a department name');
      return;
    }
    if (departments.includes(newDepartment.trim())) {
      toast.error('Department already exists');
      return;
    }
    const updated = [...departments, newDepartment.trim()];
    saveDepartments(updated);
    setNewDepartment('');
    toast.success('Department added');
  };

  const removeDepartment = (dept) => {
    const updated = departments.filter(d => d !== dept);
    saveDepartments(updated);
    toast.success('Department removed');
  };

  const addDesignation = () => {
    if (!newDesignation.trim()) {
      toast.error('Please enter a designation name');
      return;
    }
    if (designations.includes(newDesignation.trim())) {
      toast.error('Designation already exists');
      return;
    }
    const updated = [...designations, newDesignation.trim()];
    saveDesignations(updated);
    setNewDesignation('');
    toast.success('Designation added');
  };

  const removeDesignation = (desig) => {
    const updated = designations.filter(d => d !== desig);
    saveDesignations(updated);
    toast.success('Designation removed');
  };

  const saveLeaveTypes = (types) => {
    localStorage.setItem('leave_types', JSON.stringify(types));
    setLeaveTypes(types);
  };

  const addLeaveType = () => {
    if (!newLeaveType.trim()) {
      toast.error('Please enter leave type name');
      return;
    }
    if (leaveTypes.some(lt => lt.toLowerCase() === newLeaveType.toLowerCase())) {
      toast.error('Leave type already exists');
      return;
    }
    
    const updated = [...leaveTypes, newLeaveType.trim()];
    saveLeaveTypes(updated);
    setNewLeaveType('');
    toast.success('Leave type added. Set quota in Leave Policy page.');
  };

  const removeLeaveType = (typeName) => {
    const updated = leaveTypes.filter(lt => lt !== typeName);
    saveLeaveTypes(updated);
    toast.success('Leave type removed');
  };

  const saveEmployeeIdSettings = async () => {
    if (!employeeIdPrefix.trim()) {
      toast.error('Please enter a prefix');
      return;
    }
    
    if (!/^[A-Z]+$/.test(employeeIdPrefix)) {
      toast.error('Prefix must contain only uppercase letters');
      return;
    }
    
    if (employeeIdCounter < 1) {
      toast.error('Counter must be at least 1');
      return;
    }

    setSavingEmployeeId(true);
    try {
      await api.post('/employee-id-settings', {
        prefix: employeeIdPrefix.toUpperCase(),
        counter: parseInt(employeeIdCounter)
      });
      toast.success('Employee ID settings saved successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save settings');
    } finally {
      setSavingEmployeeId(false);
    }
  };

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Organization Settings
        </h1>
        <p className="text-lg text-slate-600">Manage departments and designations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Departments */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              <Settings className="w-6 h-6" />
              Departments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Department */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter department name"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addDepartment()}
                data-testid="new-department-input"
                className="flex-1"
              />
              <Button
                onClick={addDepartment}
                data-testid="add-department-btn"
                className="bg-slate-800 hover:bg-slate-900 rounded-full px-4"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Department List */}
            <div className="space-y-2">
              {departments.length === 0 ? (
                <p className="text-center text-slate-500 py-4">No departments added yet</p>
              ) : (
                departments.map((dept) => (
                  <div
                    key={dept}
                    data-testid={`dept-${dept}`}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-slate-900 font-medium">{dept}</span>
                    <button
                      onClick={() => removeDepartment(dept)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      data-testid={`remove-dept-${dept}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Designations */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              <Settings className="w-6 h-6" />
              Designations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Designation */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter designation name"
                value={newDesignation}
                onChange={(e) => setNewDesignation(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addDesignation()}
                data-testid="new-designation-input"
                className="flex-1"
              />
              <Button
                onClick={addDesignation}
                data-testid="add-designation-btn"
                className="bg-slate-800 hover:bg-slate-900 rounded-full px-4"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Designation List */}
            <div className="space-y-2">
              {designations.length === 0 ? (
                <p className="text-center text-slate-500 py-4">No designations added yet</p>
              ) : (
                designations.map((desig) => (
                  <div
                    key={desig}
                    data-testid={`desig-${desig}`}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-slate-900 font-medium">{desig}</span>
                    <button
                      onClick={() => removeDesignation(desig)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      data-testid={`remove-desig-${desig}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Leave Types */}
        <Card className="border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
              <Settings className="w-6 h-6" />
              Leave Types
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Leave Type */}
            <div className="flex gap-2">
              <Input
                placeholder="Enter leave type name (e.g., Parental Leave)"
                value={newLeaveType}
                onChange={(e) => setNewLeaveType(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addLeaveType()}
                data-testid="new-leave-type-input"
                className="flex-1"
              />
              <Button
                onClick={addLeaveType}
                data-testid="add-leave-type-btn"
                className="bg-slate-800 hover:bg-slate-900 rounded-full px-4"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Leave Type List */}
            <div className="space-y-2">
              {leaveTypes.length === 0 ? (
                <p className="text-center text-slate-500 py-4">No leave types added yet</p>
              ) : (
                leaveTypes.map((leaveType) => (
                  <div
                    key={leaveType}
                    data-testid={`leave-type-${leaveType}`}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                  >
                    <span className="text-slate-900 font-medium">{leaveType}</span>
                    <button
                      onClick={() => removeLeaveType(leaveType)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      data-testid={`remove-leave-type-${leaveType}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-slate-200">
              <p className="text-xs text-slate-600">
                <strong>Note:</strong> After adding leave types here, go to <strong>Leave Policy</strong> page to set annual quotas.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee ID Settings */}
      <Card className="border-slate-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            <Hash className="w-6 h-6" />
            Employee ID Configuration
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            Configure how employee IDs are generated. New employees will automatically get IDs like: <strong>{employeeIdPrefix}{String(employeeIdCounter).padStart(4, '0')}</strong>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="employee-id-prefix">ID Prefix *</Label>
              <Input
                id="employee-id-prefix"
                placeholder="EMP"
                value={employeeIdPrefix}
                onChange={(e) => setEmployeeIdPrefix(e.target.value.toUpperCase())}
                maxLength={10}
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">Uppercase letters only (e.g., EMP, COMP, ORG)</p>
            </div>
            
            <div>
              <Label htmlFor="employee-id-counter">Starting Counter *</Label>
              <Input
                id="employee-id-counter"
                type="number"
                placeholder="1000"
                value={employeeIdCounter}
                onChange={(e) => setEmployeeIdCounter(e.target.value)}
                min="1"
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">Next employee will start from this number</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <p className="text-sm text-amber-900">
              <strong>Example IDs:</strong> {employeeIdPrefix}{String(employeeIdCounter).padStart(4, '0')}, {employeeIdPrefix}{String(parseInt(employeeIdCounter) + 1).padStart(4, '0')}, {employeeIdPrefix}{String(parseInt(employeeIdCounter) + 2).padStart(4, '0')}
            </p>
            <p className="text-xs text-amber-800 mt-2">
              The system will auto-increment from the highest existing ID. Existing employees keep their current IDs.
            </p>
          </div>

          <div className="pt-2">
            <Button
              onClick={saveEmployeeIdSettings}
              disabled={savingEmployeeId}
              className="w-full md:w-auto bg-slate-800 hover:bg-slate-900 rounded-full"
            >
              {savingEmployeeId ? 'Saving...' : 'Save Employee ID Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;