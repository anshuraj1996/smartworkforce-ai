import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

interface Manager {
  id: string;
  name: string;
  email: string;
  designation: string;
}

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent implements OnInit {
  signupForm!: FormGroup;
  loading = false;
  errorMessage = '';
  successMessage = '';
  managers: Manager[] = [];
  showPassword = false;

  departments = [
    'Engineering',
    'Human Resources',
    'Finance',
    'Marketing',
    'Sales',
    'Operations',
    'IT',
    'Customer Support'
  ];

  roles = [
    { value: 'EMPLOYEE', label: 'Employee' },
    { value: 'MANAGER', label: 'Manager' },
    { value: 'HR', label: 'HR' }
  ];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    this.loadManagers();
  }

  initializeForm(): void {
    this.signupForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      employeeId: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]+$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      role: ['EMPLOYEE', [Validators.required]],
      department: ['', [Validators.required]],
      designation: ['', [Validators.required]],
      managerId: [null],
      joinDate: [new Date().toISOString().split('T')[0], [Validators.required]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  passwordMatchValidator(group: FormGroup): { [key: string]: boolean } | null {
    const password = group.get('password');
    const confirmPassword = group.get('confirmPassword');
    
    if (!password || !confirmPassword) {
      return null;
    }

    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  loadManagers(): void {
    const token = localStorage.getItem('token');
    this.http.get<{success: boolean, data: Manager[]}>(`${environment.apiUrl}/api/v1/users?role=MANAGER`, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: (response) => {
        this.managers = response.data;
      },
      error: (error) => {
        console.error('Failed to load managers:', error);
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.signupForm.invalid) {
      Object.keys(this.signupForm.controls).forEach(key => {
        this.signupForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const formValue = this.signupForm.value;
    const { confirmPassword, ...registrationData } = formValue;

    const token = localStorage.getItem('token');
    this.http.post<{success: boolean, message: string, data: any}>(
      `${environment.apiUrl}/api/v1/users/register`,
      registrationData,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (response) => {
        this.loading = false;
        this.successMessage = response.message || 'Employee registered successfully!';
        this.signupForm.reset({
          role: 'EMPLOYEE',
          joinDate: new Date().toISOString().split('T')[0]
        });
        
        // Redirect after 2 seconds
        setTimeout(() => {
          this.router.navigate(['/dashboard/team']);
        }, 2000);
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.error?.message || 'Failed to register employee. Please try again.';
        console.error('Registration error:', error);
      }
    });
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.signupForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  getFieldError(fieldName: string): string {
    const field = this.signupForm.get(fieldName);
    if (!field || !field.errors) return '';

    if (field.errors['required']) return `${this.getFieldLabel(fieldName)} is required`;
    if (field.errors['email']) return 'Invalid email format';
    if (field.errors['minlength']) return `Minimum ${field.errors['minlength'].requiredLength} characters required`;
    if (field.errors['pattern']) return 'Only uppercase letters and numbers allowed';
    
    return '';
  }

  getFieldLabel(fieldName: string): string {
    const labels: { [key: string]: string } = {
      name: 'Name',
      email: 'Email',
      employeeId: 'Employee ID',
      password: 'Password',
      confirmPassword: 'Confirm Password',
      role: 'Role',
      department: 'Department',
      designation: 'Designation',
      joinDate: 'Join Date'
    };
    return labels[fieldName] || fieldName;
  }

  cancel(): void {
    this.router.navigate(['/dashboard/team']);
  }
}
