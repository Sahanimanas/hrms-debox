import React, { useState, useEffect } from 'react';
import { Users, ChevronRight, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { toast } from 'sonner';

const HierarchyPage = () => {
  const [employees, setEmployees] = useState([]);
  const [hierarchy, setHierarchy] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const response = await api.get('/employees');
      const emps = response.data;
      setEmployees(emps);
      buildHierarchy(emps);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      toast.error('Failed to load hierarchy');
    } finally {
      setLoading(false);
    }
  };

  const buildHierarchy = (emps) => {
    // Build tree structure: Admin → Managers → Employees (by department)
    const deptMap = {};
    
    emps.forEach(emp => {
      if (!deptMap[emp.department]) {
        deptMap[emp.department] = {
          admins: [],
          managers: [],
          employees: []
        };
      }
      
      if (emp.role === 'admin') {
        deptMap[emp.department].admins.push(emp);
      } else if (emp.role === 'manager') {
        deptMap[emp.department].managers.push(emp);
      } else {
        deptMap[emp.department].employees.push(emp);
      }
    });
    
    setHierarchy(deptMap);
  };

  // Get employees for a specific manager based on their email
  const getTeamMembers = (managerEmail) => {
    return employees.filter(emp => emp.manager_email === managerEmail);
  };
  
  // Get all employees in a department (for role-based hierarchy)
  const getDepartmentEmployees = (department) => {
    return employees.filter(emp => emp.department === department && emp.role === 'employee');
  };
  
  const getDepartmentManagers = (department) => {
    return employees.filter(emp => emp.department === department && emp.role === 'manager');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">Loading hierarchy...</div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Plus Jakarta Sans' }}>
          Organization Hierarchy
        </h1>
        <p className="text-lg text-slate-600">View your company's organizational structure</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Total Employees</p>
            <p className="text-2xl font-bold text-slate-900">{employees.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Admins</p>
            <p className="text-2xl font-bold text-amber-600">
              {employees.filter(e => e.role === 'admin').length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Managers</p>
            <p className="text-2xl font-bold text-purple-600">
              {employees.filter(e => e.role === 'manager').length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Employees</p>
            <p className="text-2xl font-bold text-emerald-600">
              {employees.filter(e => e.role === 'employee').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Hierarchy by Department - Tree Structure */}
      <div className="space-y-6">
        {Object.keys(hierarchy).map((department) => {
          const deptAdmins = hierarchy[department].admins;
          const deptManagers = hierarchy[department].managers;
          const deptEmployees = hierarchy[department].employees;
          
          return (
            <Card key={department} className="border-slate-100 shadow-sm overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200">
                <CardTitle className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
                  <Building2 className="w-6 h-6" />
                  {department}
                  <span className="text-sm font-normal text-slate-500 ml-auto">
                    {deptAdmins.length + deptManagers.length + deptEmployees.length} people
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="relative">
                  {/* Admins at Top */}
                  {deptAdmins.length > 0 && (
                    <div className="mb-8">
                      <div className="flex justify-center mb-6">
                        <div className="inline-flex flex-col items-center">
                          {deptAdmins.map((admin, idx) => (
                            <div key={admin.id} className="relative">
                              <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-xl shadow-lg mb-4 min-w-[280px]">
                                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0 border-2 border-white/30">
                                  <Users className="w-6 h-6" />
                                </div>
                                <div className="flex-1">
                                  <p className="font-bold text-lg">{admin.full_name}</p>
                                  <p className="text-sm text-amber-100">{admin.designation}</p>
                                </div>
                                <Badge className="bg-white text-amber-700 hover:bg-white font-semibold">CEO/Admin</Badge>
                              </div>
                              {/* Connector line down */}
                              {(deptManagers.length > 0 || deptEmployees.length > 0) && (
                                <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-8 bg-slate-300" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Managers Row */}
                      {deptManagers.length > 0 && (
                        <div className="relative">
                          {/* Horizontal connector line */}
                          {deptManagers.length > 1 && (
                            <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-slate-300" />
                          )}
                          
                          <div className={`grid gap-6 ${deptManagers.length === 1 ? 'grid-cols-1 place-items-center' : deptManagers.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                            {deptManagers.map((manager) => {
                              const teamMembers = getTeamMembers(manager.email);
                              
                              return (
                                <div key={manager.id} className="relative flex flex-col items-center">
                                  {/* Vertical connector to parent */}
                                  <div className="w-0.5 h-6 bg-slate-300 mb-2" />
                                  
                                  {/* Manager Card */}
                                  <div className="w-full">
                                    <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl shadow-md mb-4">
                                      <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0 border-2 border-white/30">
                                        <Users className="w-5 h-5" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold truncate">{manager.full_name}</p>
                                        <p className="text-xs text-purple-100 truncate">{manager.designation}</p>
                                      </div>
                                    </div>

                                    {/* Employees under this manager */}
                                    {teamMembers.length > 0 && (
                                      <div className="relative">
                                        {/* Vertical connector to employees */}
                                        <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-4 bg-slate-300 -top-4" />
                                        
                                        <div className="space-y-2 pl-6 border-l-2 border-slate-200">
                                          {teamMembers.map((member) => (
                                            <div
                                              key={member.id}
                                              className="relative flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all"
                                            >
                                              {/* Horizontal connector */}
                                              <div className="absolute -left-6 top-1/2 w-6 h-0.5 bg-slate-200" />
                                              
                                              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                                                <span className="text-xs font-semibold text-slate-600">
                                                  {member.full_name.charAt(0)}
                                                </span>
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <p className="font-medium text-slate-900 text-sm truncate">{member.full_name}</p>
                                                <p className="text-xs text-slate-500 truncate">{member.designation}</p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Employees without manager (report directly to admin) */}
                      {deptEmployees.filter(emp => !emp.manager_email).length > 0 && (
                        <div className="mt-8 pt-6 border-t border-slate-200">
                          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 text-center">
                            Employees Reporting Directly to Admin
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {deptEmployees
                              .filter(emp => !emp.manager_email)
                              .map((employee) => (
                                <div
                                  key={employee.id}
                                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                                >
                                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-semibold text-slate-600">
                                      {employee.full_name.charAt(0)}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-900 text-sm truncate">{employee.full_name}</p>
                                    <p className="text-xs text-slate-500 truncate">{employee.designation}</p>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* If no admins, show managers at top */}
                  {deptAdmins.length === 0 && deptManagers.length > 0 && (
                    <div className="space-y-6">
                      <p className="text-center text-sm text-slate-500 mb-4">No admin assigned to this department</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {deptManagers.map((manager) => {
                          const teamMembers = getTeamMembers(manager.email);
                          return (
                            <div key={manager.id} className="border border-slate-200 rounded-lg overflow-hidden">
                              <div className="flex items-center gap-3 p-4 bg-purple-500 text-white">
                                <Users className="w-5 h-5" />
                                <div className="flex-1">
                                  <p className="font-bold">{manager.full_name}</p>
                                  <p className="text-xs text-purple-100">{manager.designation}</p>
                                </div>
                                <Badge className="bg-white text-purple-700">Manager</Badge>
                              </div>
                              {teamMembers.length > 0 && (
                                <div className="p-3 bg-white space-y-2">
                                  {teamMembers.map((member) => (
                                    <div key={member.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded text-sm">
                                      <span className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs">
                                        {member.full_name.charAt(0)}
                                      </span>
                                      <span className="flex-1 truncate">{member.full_name}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* If no structure at all */}
                  {deptAdmins.length === 0 && deptManagers.length === 0 && deptEmployees.length > 0 && (
                    <div className="text-center py-6">
                      <p className="text-slate-500 mb-4">No hierarchy defined - showing all employees</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {deptEmployees.map((emp) => (
                          <div key={emp.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                            <p className="font-medium text-slate-900">{emp.full_name}</p>
                            <p className="text-xs text-slate-500">{emp.designation}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {employees.length === 0 && (
        <Card className="border-slate-100 shadow-sm">
          <CardContent className="py-12">
            <div className="text-center text-slate-500">
              <Users className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">No employees found</p>
              <p className="text-sm">Add employees to see the organization hierarchy</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default HierarchyPage;
