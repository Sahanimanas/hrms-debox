import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { setAuth, isAuthenticated } from '@/lib/auth';

const LoginPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Login form state
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });

  // Login error state
  const [loginErrors, setLoginErrors] = useState({
    email: '',
    password: '',
    general: '',
  });

  // Register form state
  const [registerForm, setRegisterForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'employee',
    department: '',
    designation: '',
    phone: '',
    manager_email: '',
  });

  // Register error state
  const [registerErrors, setRegisterErrors] = useState({
    email: '',
    password: '',
    general: '',
  });

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/');
    }
  }, [navigate]);

  // Clear login errors when form changes
  const handleLoginChange = (field, value) => {
    setLoginForm({ ...loginForm, [field]: value });
    // Clear related error when user starts typing
    if (loginErrors[field] || loginErrors.general) {
      setLoginErrors({ ...loginErrors, [field]: '', general: '' });
    }
  };

  // Clear register errors when form changes
  const handleRegisterChange = (field, value) => {
    setRegisterForm({ ...registerForm, [field]: value });
    if (registerErrors[field] || registerErrors.general) {
      setRegisterErrors({ ...registerErrors, [field]: '', general: '' });
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginErrors({ email: '', password: '', general: '' });

    try {
      const response = await api.post('/auth/login', loginForm);
      const { access_token, user } = response.data;
      setAuth(access_token, user);
      toast.success('Login successful!');
      navigate('/');
    } catch (error) {
      const errorData = error.response?.data;
      const errorCode = errorData?.error_code;
      const errorMessage = errorData?.detail || 'Login failed';

      // Handle specific error codes
      if (errorCode === 'USER_NOT_FOUND') {
        setLoginErrors({
          email: 'No account found with this email',
          password: '',
          general: '',
        });
      } else if (errorCode === 'INVALID_PASSWORD') {
        setLoginErrors({
          email: '',
          password: 'Incorrect password. Please try again.',
          general: '',
        });
      } else {
        // Generic error
        setLoginErrors({
          email: '',
          password: '',
          general: errorMessage,
        });
        toast.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setRegisterErrors({ email: '', password: '', general: '' });

    try {
      const response = await api.post('/auth/register', registerForm);
      const { access_token, user } = response.data;
      setAuth(access_token, user);
      toast.success('Registration successful!');
      navigate('/');
    } catch (error) {
      const errorData = error.response?.data;
      let errorMessage = 'Registration failed';

      if (errorData?.detail) {
        const detail = errorData.detail;

        // Check for email already registered
        if (typeof detail === 'string' && detail.toLowerCase().includes('email already')) {
          setRegisterErrors({
            email: 'This email is already registered',
            password: '',
            general: '',
          });
          return;
        }

        // Handle array of validation errors
        if (Array.isArray(detail)) {
          const errors = detail.map(err => {
            if (typeof err === 'object' && err.msg) {
              return `${err.loc ? err.loc[err.loc.length - 1] : 'Field'}: ${err.msg}`;
            }
            return String(err);
          });
          errorMessage = errors.join('; ');
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (typeof detail === 'object') {
          errorMessage = JSON.stringify(detail);
        }
      }

      setRegisterErrors({
        email: '',
        password: '',
        general: errorMessage,
      });
      toast.error(errorMessage);
      console.error('Registration error:', error.response?.data);
    } finally {
      setLoading(false);
    }
  };

  // Error message component
  const ErrorMessage = ({ message }) => {
    if (!message) return null;
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-red-600">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm">{message}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <img src="/logo_debox_tagline-w.png" alt="DeBox" className="h-16 w-auto mb-4" />
            <p className="text-lg text-slate-600">Employee Leave Management System</p>
          </div>

          <Tabs defaultValue={new URLSearchParams(window.location.search).get('tab') === 'register' ? 'register' : 'login'} className="w-full">
            <TabsList className="grid w-full grid-cols-1 mb-6">
              <TabsTrigger value="login" data-testid="login-tab">Login</TabsTrigger>
              <TabsTrigger value="register" data-testid="register-tab">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card>
                <CardContent className="pt-6">
                  <form onSubmit={handleLogin} className="space-y-4">
                    {/* General error banner */}
                    {loginErrors.general && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700">
                          <AlertCircle className="w-5 h-5" />
                          <span className="text-sm font-medium">{loginErrors.general}</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        data-testid="login-email-input"
                        type="email"
                        placeholder="john@example.com"
                        value={loginForm.email}
                        onChange={(e) => handleLoginChange('email', e.target.value)}
                        required
                        className={`mt-1 ${loginErrors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                      />
                      <ErrorMessage message={loginErrors.email} />
                    </div>

                    <div>
                      <Label htmlFor="login-password">Password</Label>
                      <div className="relative mt-1">
                        <Input
                          id="login-password"
                          data-testid="login-password-input"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={loginForm.password}
                          onChange={(e) => handleLoginChange('password', e.target.value)}
                          required
                          className={`pr-10 ${loginErrors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <ErrorMessage message={loginErrors.password} />
                    </div>

                    <Button
                      type="submit"
                      data-testid="login-submit-btn"
                      className="w-full bg-slate-800 hover:bg-slate-900 rounded-full"
                      disabled={loading}
                    >
                      {loading ? 'Logging in...' : 'Login'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card>
                <CardContent className="pt-6">
                  <form onSubmit={handleRegister} className="space-y-4" noValidate>
                    {/* General error banner */}
                    {registerErrors.general && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700">
                          <AlertCircle className="w-5 h-5" />
                          <span className="text-sm font-medium">{registerErrors.general}</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="reg-name">Full Name</Label>
                      <Input
                        id="reg-name"
                        data-testid="register-name-input"
                        type="text"
                        placeholder="John Doe"
                        value={registerForm.full_name}
                        onChange={(e) => handleRegisterChange('full_name', e.target.value)}
                        required
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="reg-email">Email</Label>
                      <Input
                        id="reg-email"
                        data-testid="register-email-input"
                        type="email"
                        placeholder="john@example.com"
                        value={registerForm.email}
                        onChange={(e) => handleRegisterChange('email', e.target.value)}
                        required
                        className={`mt-1 ${registerErrors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                      />
                      <ErrorMessage message={registerErrors.email} />
                    </div>

                    <div>
                      <Label htmlFor="reg-password">Password</Label>
                      <div className="relative mt-1">
                        <Input
                          id="reg-password"
                          data-testid="register-password-input"
                          type={showRegPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={registerForm.password}
                          onChange={(e) => handleRegisterChange('password', e.target.value)}
                          required
                          className={`pr-10 ${registerErrors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword(!showRegPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <ErrorMessage message={registerErrors.password} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="reg-department">Department</Label>
                        <Input
                          id="reg-department"
                          data-testid="register-department-input"
                          type="text"
                          placeholder="Engineering"
                          value={registerForm.department}
                          onChange={(e) => handleRegisterChange('department', e.target.value)}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="reg-designation">Designation</Label>
                        <Input
                          id="reg-designation"
                          data-testid="register-designation-input"
                          type="text"
                          placeholder="Developer"
                          value={registerForm.designation}
                          onChange={(e) => handleRegisterChange('designation', e.target.value)}
                          required
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="reg-role">Role</Label>
                      <Select
                        value={registerForm.role}
                        onValueChange={(value) => handleRegisterChange('role', value)}
                      >
                        <SelectTrigger data-testid="register-role-select" className="mt-1">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="reg-phone">Phone (Optional)</Label>
                      <Input
                        id="reg-phone"
                        data-testid="register-phone-input"
                        type="tel"
                        placeholder="+1234567890"
                        value={registerForm.phone}
                        onChange={(e) => handleRegisterChange('phone', e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="reg-manager">Manager Email (Optional)</Label>
                      <Input
                        id="reg-manager"
                        data-testid="register-manager-input"
                        type="email"
                        placeholder="manager@example.com"
                        value={registerForm.manager_email}
                        onChange={(e) => handleRegisterChange('manager_email', e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <Button
                      type="submit"
                      data-testid="register-submit-btn"
                      className="w-full bg-slate-800 hover:bg-slate-900 rounded-full"
                      disabled={loading}
                    >
                      {loading ? 'Registering...' : 'Register'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right Side - Image */}
      <div className="hidden lg:block lg:flex-1 relative">
        <img
          src="https://images.unsplash.com/photo-1733471754436-a7b293256c43?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzZ8MHwxfHNlYXJjaHwyfHxtaW5pbWFsaXN0JTIwYWJzdHJhY3QlMjBvZmZpY2UlMjBhcmNoaXRlY3R1cmUlMjBicmlnaHR8ZW58MHx8fHwxNzY1NjU3NjY2fDA&ixlib=rb-4.1.0&q=85"
          alt="Office"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/20" />
      </div>
    </div>
  );
};

export default LoginPage;
