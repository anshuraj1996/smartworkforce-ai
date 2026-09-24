import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Get the auth token from the service
    const authToken = this.authService.getToken();

    // Clone the request and add the authorization header if token exists
    let authReq = req;
    if (authToken) {
      authReq = req.clone({
        setHeaders: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
    }

    // Handle the request and catch errors
    return next.handle(authReq).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          // Token expired or invalid, redirect to login
          this.authService.logout().subscribe(() => {
            this.router.navigate(['/login']);
          });
        } else if (error.status === 403) {
          // Forbidden - user doesn't have permission
          console.error('Access forbidden:', error.message);
          // Could show a toast notification here
        } else if (error.status >= 500) {
          // Server error
          console.error('Server error:', error.message);
          // Could show a global error message here
        }

        return throwError(() => error);
      })
    );
  }
}