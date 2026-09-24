import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, retry, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface ApiResponse<T = any> {
  data: T;
  message: string;
  success: boolean;
  timestamp: string;
}

export interface PaginatedResponse<T = any> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = environment.apiUrl;
  private readonly timeout = environment.apiTimeout || 30000;

  constructor(private http: HttpClient) {}

  /**
   * GET request with type safety
   */
  get<T>(endpoint: string, params?: any): Observable<T> {
    const httpParams = this.buildHttpParams(params);
    
    return this.http.get<T>(`${this.baseUrl}${endpoint}`, { params: httpParams })
      .pipe(
        timeout(this.timeout),
        retry(1),
        catchError(this.handleError)
      );
  }

  /**
   * POST request with type safety
   */
  post<T>(endpoint: string, data?: any, options?: any): Observable<T> {
    const headers = this.buildHeaders(options?.headers);
    
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, data, { headers })
      .pipe(
        timeout(this.timeout),
        catchError(this.handleError)
      );
  }

  /**
   * PUT request with type safety
   */
  put<T>(endpoint: string, data?: any, options?: any): Observable<T> {
    const headers = this.buildHeaders(options?.headers);
    
    return this.http.put<T>(`${this.baseUrl}${endpoint}`, data, { headers })
      .pipe(
        timeout(this.timeout),
        catchError(this.handleError)
      );
  }

  /**
   * PATCH request with type safety
   */
  patch<T>(endpoint: string, data?: any, options?: any): Observable<T> {
    const headers = this.buildHeaders(options?.headers);
    
    return this.http.patch<T>(`${this.baseUrl}${endpoint}`, data, { headers })
      .pipe(
        timeout(this.timeout),
        catchError(this.handleError)
      );
  }

  /**
   * DELETE request with type safety
   */
  delete<T>(endpoint: string, params?: any): Observable<T> {
    const httpParams = this.buildHttpParams(params);
    
    return this.http.delete<T>(`${this.baseUrl}${endpoint}`, { params: httpParams })
      .pipe(
        timeout(this.timeout),
        catchError(this.handleError)
      );
  }

  /**
   * Upload file with progress tracking
   */
  uploadFile<T>(endpoint: string, file: File, additionalData?: any): Observable<T> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (additionalData) {
      Object.keys(additionalData).forEach(key => {
        formData.append(key, additionalData[key]);
      });
    }

    return this.http.post<T>(`${this.baseUrl}${endpoint}`, formData)
      .pipe(
        timeout(60000), // Extended timeout for file uploads
        catchError(this.handleError)
      );
  }

  /**
   * Download file as blob
   */
  downloadFile(endpoint: string, params?: any): Observable<Blob> {
    const httpParams = this.buildHttpParams(params);
    
    return this.http.get(`${this.baseUrl}${endpoint}`, {
      params: httpParams,
      responseType: 'blob'
    }).pipe(
      timeout(60000), // Extended timeout for downloads
      catchError(this.handleError)
    );
  }

  /**
   * Get paginated data
   */
  getPaginated<T>(endpoint: string, page: number = 1, limit: number = 10, params?: any): Observable<PaginatedResponse<T>> {
    const allParams = {
      page: page.toString(),
      limit: limit.toString(),
      ...params
    };
    
    return this.get<PaginatedResponse<T>>(endpoint, allParams);
  }

  /**
   * Search with query parameters
   */
  search<T>(endpoint: string, query: string, filters?: any): Observable<T[]> {
    const params = {
      q: query,
      ...filters
    };
    
    return this.get<T[]>(endpoint, params);
  }

  /**
   * Health check endpoint
   */
  healthCheck(): Observable<any> {
    return this.get('/health');
  }

  /**
   * Build HTTP parameters from object
   */
  private buildHttpParams(params?: any): HttpParams {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        const value = params[key];
        if (value !== null && value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach(item => {
              httpParams = httpParams.append(`${key}[]`, item.toString());
            });
          } else {
            httpParams = httpParams.set(key, value.toString());
          }
        }
      });
    }
    
    return httpParams;
  }

  /**
   * Build HTTP headers
   */
  private buildHeaders(additionalHeaders?: any): HttpHeaders {
    let headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
    
    if (additionalHeaders) {
      Object.keys(additionalHeaders).forEach(key => {
        headers = headers.set(key, additionalHeaders[key]);
      });
    }
    
    return headers;
  }

  /**
   * Handle HTTP errors
   */
  private handleError = (error: HttpErrorResponse): Observable<never> => {
    let errorMessage = 'An unexpected error occurred';
    let errorCode = 'UNKNOWN_ERROR';
    
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = error.error.message;
      errorCode = 'CLIENT_ERROR';
    } else {
      // Server-side error
      switch (error.status) {
        case 400:
          errorMessage = error.error?.message || 'Bad Request';
          errorCode = 'BAD_REQUEST';
          break;
        case 401:
          errorMessage = 'Unauthorized access';
          errorCode = 'UNAUTHORIZED';
          break;
        case 403:
          errorMessage = 'Access forbidden';
          errorCode = 'FORBIDDEN';
          break;
        case 404:
          errorMessage = 'Resource not found';
          errorCode = 'NOT_FOUND';
          break;
        case 422:
          errorMessage = error.error?.message || 'Validation failed';
          errorCode = 'VALIDATION_ERROR';
          break;
        case 429:
          errorMessage = 'Too many requests';
          errorCode = 'RATE_LIMIT';
          break;
        case 500:
          errorMessage = 'Internal server error';
          errorCode = 'SERVER_ERROR';
          break;
        case 503:
          errorMessage = 'Service unavailable';
          errorCode = 'SERVICE_UNAVAILABLE';
          break;
        default:
          errorMessage = error.error?.message || `Error ${error.status}: ${error.statusText}`;
          errorCode = `HTTP_${error.status}`;
      }
    }

    const apiError: ApiError = {
      code: errorCode,
      message: errorMessage,
      details: error.error
    };

    console.error('API Error:', apiError);
    
    return throwError(() => apiError);
  }

  /**
   * Get full URL for endpoint
   */
  getFullUrl(endpoint: string): string {
    return `${this.baseUrl}${endpoint}`;
  }

  /**
   * Check if endpoint is available
   */
  ping(endpoint: string): Observable<boolean> {
    return new Observable(observer => {
      this.http.head(`${this.baseUrl}${endpoint}`).subscribe({
        next: () => {
          observer.next(true);
          observer.complete();
        },
        error: () => {
          observer.next(false);
          observer.complete();
        }
      });
    });
  }
}